'use strict'

const prisma = require('../../lib/prisma')
const { validateDescription } = require('./validate')
const { lookup } = require('./library')
const { buildBatchPrompt, matchBatchReply, DEFAULT_BATCH } = require('./batchPrompt')
const { ask, describeProvider, ProviderError } = require('./provider')

/**
 * Writing a description for every dish that has none.
 *
 * This runs after an import rather than inside it. Generation on this machine
 * is about 4.7 tokens a second, so a menu of 668 dishes is over an hour of
 * work - long enough that doing it inside the import would look like a freeze
 * and lose everything on any failure.
 *
 * Each description is saved the moment it is written, so stopping the job, or
 * the server restarting, costs at most one dish. Progress is held in memory
 * and is not meant to survive a restart; the descriptions are.
 */

// One job per restaurant. A second start while one runs is refused rather
// than quietly writing the same dishes twice.
const jobs = new Map()

// If the model is unreachable, fail fast instead of grinding through hundreds
// of identical errors.
const MAX_CONSECUTIVE_FAILURES = 5

const emptyDescription = { OR: [{ description: null }, { description: '' }] }

/** Dishes that would be described, without describing them. */
async function countPending(restaurantId) {
  return prisma.foodItem.count({ where: { restaurantId, ...emptyDescription } })
}

/**
 * Every dish still without a description, named.
 *
 * A count on its own cannot be acted on: "3 not known" tells nobody WHICH
 * three. This is read from the database rather than from the finished job, so
 * it stays right after a restart, after a second run, and after a description
 * is written by hand - the dish simply stops being on the list.
 *
 * Not capped. A menu where the model recognised little needs the whole list,
 * which is the only way to finish the menu.
 */
async function listPending(restaurantId) {
  const dishes = await prisma.foodItem.findMany({
    where: { restaurantId, ...emptyDescription },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
    },
    orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })

  return dishes.map((dish) => ({
    id: dish.id,
    name: dish.name,
    category: dish.category ? dish.category.name : null,
  }))
}

/**
 * Write a description somebody typed themselves.
 *
 * Deliberately NOT put through validateDescription. That check exists to hold
 * the model to a house style; a person writing about their own dish is the
 * authority on it and is not argued with. Only trimmed, and only on a dish
 * belonging to this restaurant - the id arrives from a browser.
 */
async function saveDescription(restaurantId, dishId, description) {
  const text = String(description == null ? '' : description).trim()
  if (text === '') return { ok: false, reason: 'empty' }
  if (text.length > 400) return { ok: false, reason: 'too_long' }

  const result = await prisma.foodItem.updateMany({
    where: { id: dishId, restaurantId },
    data: { description: text },
  })

  if (result.count === 0) return { ok: false, reason: 'not_found' }
  return { ok: true, description: text }
}

function statusOf(restaurantId) {
  const job = jobs.get(restaurantId)
  if (!job) return { running: false }

  return {
    running: job.running,
    total: job.total,
    done: job.done,
    written: job.written,
    fromLibrary: job.fromLibrary,
    fromModel: job.fromModel,
    skipped: job.skipped,
    failed: job.failed,
    current: job.current,
    provider: job.provider,
    stoppedBecause: job.stoppedBecause,
    errorCode: job.errorCode || null,
    startedAt: job.startedAt,
  }
}

function stop(restaurantId) {
  const job = jobs.get(restaurantId)
  if (!job || !job.running) return false
  job.stopRequested = true
  return true
}

/** Write a description to a dish, but never over one already there. */
async function save(dishId, description) {
  const updated = await prisma.foodItem.updateMany({
    where: { id: dishId, ...emptyDescription },
    data: { description },
  })
  return updated.count > 0
}

/**
 * Everything the library already knows, written straight in.
 *
 * Most of an Indian menu is dishes that appear on thousands of menus, or one
 * preparation applied to a list of ingredients. These cost nothing and take
 * no time, so they are done first and whatever is left is what the model has
 * to be paid for in seconds.
 */
async function runLibraryPass(dishes, job) {
  const unknown = []

  for (const dish of dishes) {
    if (job.stopRequested) break

    const known = lookup(dish.name)
    if (!known) {
      unknown.push(dish)
      continue
    }

    const saved = await save(dish.id, known.description)
    if (saved) {
      job.written += 1
      job.fromLibrary += 1
    } else {
      job.skipped += 1
    }
    job.done += 1
  }

  return unknown
}

/** One batch of dishes through whichever provider is configured. */
async function runBatch(batch, job) {
  const reply = await ask(buildBatchPrompt(batch))

  for (const { dish, raw } of matchBatchReply(reply, batch)) {
    if (raw === null) {
      // Asked about and not answered. Not a dish anyone can fix, so it is a
      // failure rather than something left for the admin to look at.
      job.failed += 1
      job.done += 1
      continue
    }

    const checked = validateDescription(raw, dish.name)
    if (!checked.ok) {
      job.skipped += 1
      job.done += 1
      continue
    }

    const saved = await save(dish.id, checked.description)
    if (saved) {
      job.written += 1
      job.fromModel += 1
    } else {
      job.skipped += 1
    }
    job.done += 1
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Start describing. Returns immediately; the work continues in the background.
 */
async function start(restaurantId) {
  const existing = jobs.get(restaurantId)
  if (existing && existing.running) {
    return { ok: false, reason: 'already_running', status: statusOf(restaurantId) }
  }

  const dishes = await prisma.foodItem.findMany({
    where: { restaurantId, ...emptyDescription },
    select: { id: true, name: true, category: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  if (dishes.length === 0) {
    return { ok: false, reason: 'nothing_to_do' }
  }

  const provider = describeProvider()

  const job = {
    running: true,
    provider,
    stopRequested: false,
    total: dishes.length,
    done: 0,
    written: 0,
    fromLibrary: 0,
    fromModel: 0,
    skipped: 0,
    failed: 0,
    current: null,
    stoppedBecause: null,
    errorCode: null,
    startedAt: new Date().toISOString(),
  }
  jobs.set(restaurantId, job)

  // Deliberately not awaited: the caller gets an immediate reply and polls.
  ;(async () => {
    // Free tiers limit tokens per minute more than requests, so leave a gap
    // between calls rather than firing them all at once and being throttled.
    const gapMs = Number(process.env.DESCRIPTION_REQUEST_GAP_MS || (provider.fast ? 7000 : 0))
    const batchSize = Math.max(1, Number(process.env.DESCRIPTION_BATCH_SIZE || DEFAULT_BATCH))

    let consecutiveFailures = 0

    /**
     * Describe one batch, and if the service refuses it, try smaller pieces.
     *
     * A batch used to be all or nothing, and worse, one refused batch ended
     * the whole job: a run stopped with "26 written, 15 failed" because a
     * single request came back malformed. The other fourteen dishes in that
     * batch were fine and were never asked about again.
     *
     * Halving isolates the problem. A batch of ten that fails becomes two of
     * five; whichever half is at fault halves again, down to the single dish
     * the model cannot answer for - which is counted as failed, on its own,
     * while every other dish still gets its description.
     *
     * A rejected API key is the one fault that does not shrink away, so that
     * one is thrown on and stops the run.
     */
    const runPiece = async (piece) => {
      try {
        await runBatch(piece, job)
        consecutiveFailures = 0
        return
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        if (err.code === 'rejected') throw err

        if (piece.length > 1) {
          const half = Math.ceil(piece.length / 2)
          console.warn(`[descriptions] ${err.code} on ${piece.length} dishes - splitting`)
          if (gapMs > 0) await sleep(gapMs)
          await runPiece(piece.slice(0, half))
          if (gapMs > 0) await sleep(gapMs)
          await runPiece(piece.slice(half))
          return
        }

        // One dish the service will not answer for. Left blank, named in the
        // log, and the run carries on.
        job.failed += 1
        job.done += 1
        job.errorCode = err.code
        console.error(`[descriptions] ${piece[0].name}: ${err.code} - ${err.message}`)

        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw err
      }
    }

    const unknown = await runLibraryPass(dishes, job)

    for (let i = 0; i < unknown.length; i += batchSize) {
      if (job.stopRequested) {
        job.stoppedBecause = 'you stopped it'
        break
      }

      const batch = unknown.slice(i, i + batchSize)
      job.current = batch[0].name

      try {
        await runPiece(batch)
      } catch (err) {
        // Only a fault that will repeat for every remaining dish gets here.
        job.errorCode = err.code || 'failed'
        job.stoppedBecause = err.message || `the description service stopped responding (${err.code})`
        console.error(`[descriptions] giving up: ${err.code} - ${err.message}`)
        break
      }

      if (gapMs > 0 && i + batchSize < unknown.length) await sleep(gapMs)
    }

    job.running = false
    job.current = null
    console.log(
      `[descriptions] restaurant ${restaurantId}: ${job.written} written, ` +
        `${job.skipped} left blank, ${job.failed} failed` +
        (job.stoppedBecause ? ` - ${job.stoppedBecause}` : ''),
    )
  })()

  return { ok: true, status: statusOf(restaurantId) }
}

module.exports = {
  start,
  stop,
  listPending,
  saveDescription,
  statusOf,
  countPending,
  runLibraryPass,
  runBatch,
  MAX_CONSECUTIVE_FAILURES,
}
