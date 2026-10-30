'use strict'

const runner = require('../services/dishDescriptions/runner')
const { describeProvider } = require('../services/dishDescriptions/provider')
const { suggestFor } = require('../services/dishDescriptions/suggest')
const prisma = require('../lib/prisma')

/**
 * Writing descriptions for dishes that have none.
 *
 * The restaurant always comes from the session, never the request, so no
 * account can start a job against another restaurant's menu.
 */

const restaurantOf = (req, res) => {
  const restaurantId = req.user.restaurantId
  if (!restaurantId) {
    res.status(403).json({ error: 'This account is not linked to a restaurant.' })
    return null
  }
  return restaurantId
}

/** GET /api/restaurant/descriptions/status */
const status = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  // The names, not only the count. "3 not known" cannot be acted on.
  const [pending, pendingList, job] = await Promise.all([
    runner.countPending(restaurantId),
    runner.listPending(restaurantId),
    Promise.resolve(runner.statusOf(restaurantId)),
  ])

  // Which provider is configured, so the panel can say how long this will
  // take. The key itself is never sent anywhere.
  return res.json({ pending, pendingList, job, provider: describeProvider() })
}

/** POST /api/restaurant/descriptions/start */
const start = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  const result = await runner.start(restaurantId)

  if (!result.ok && result.reason === 'already_running') {
    return res.status(409).json({ error: 'Descriptions are already being written.', job: result.status })
  }
  if (!result.ok && result.reason === 'nothing_to_do') {
    return res.status(400).json({ error: 'Every dish already has a description.' })
  }

  return res.json({ job: result.status })
}

/** POST /api/restaurant/descriptions/stop */
const stop = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  const stopped = runner.stop(restaurantId)
  return res.json({ stopped, job: runner.statusOf(restaurantId) })
}

/**
 * PATCH /api/restaurant/descriptions/:dishId
 *
 * A description typed by hand, for a dish the model could not place. The
 * restaurant comes from the session, so a dish id from the browser can only
 * ever reach this restaurant's own menu.
 */
const write = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  const result = await runner.saveDescription(restaurantId, req.params.dishId, req.body?.description)

  if (!result.ok) {
    const message = {
      empty: 'Write something first.',
      too_long: 'That is longer than 400 characters.',
      not_found: 'That dish is not on this menu.',
    }[result.reason] || 'The description could not be saved.'
    return res.status(result.reason === 'not_found' ? 404 : 400).json({ error: message })
  }

  return res.json({ ok: true, description: result.description })
}

/**
 * POST /api/restaurant/descriptions/:dishId/suggest
 *
 * Three ways of describing one dish, for the admin to choose between.
 *
 * The automatic pass throws a description away when it runs long or phrases
 * itself badly, which leaves a blank for a dish the model knew. This offers
 * what it would have said, marked with whatever is wrong with each line, and
 * lets a person decide instead of a word count.
 */
const suggest = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  // The dish is looked up under this restaurant, so an id from the browser
  // cannot reach another menu.
  const dish = await prisma.foodItem.findFirst({
    where: { id: req.params.dishId, restaurantId },
    select: { name: true, category: { select: { name: true } } },
  })

  if (!dish) return res.status(404).json({ error: 'That dish is not on this menu.' })

  try {
    const result = await suggestFor({
      name: dish.name,
      categoryName: dish.category ? dish.category.name : null,
    })

    return res.json(result)
  } catch (err) {
    // A provider fault is not this dish's fault, and the admin can still
    // write the line by hand. Say which it was.
    return res.status(503).json({
      error: err.message || 'The description service could not be reached.',
      code: err.code || 'failed',
    })
  }
}

module.exports = { status, start, stop, write, suggest }
