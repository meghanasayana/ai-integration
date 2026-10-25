'use strict'

/**
 * Menu import endpoints.
 *
 * Two steps, deliberately separate:
 *
 *   POST /restaurant/menu-import/extract   file  -> plan   (no database writes)
 *   POST /restaurant/menu-import/commit    plan  -> report (writes)
 *
 * The split is the safety model: extraction can never change the menu, and
 * nothing is written until the admin has seen the plan and sent back the
 * entries they accept.
 */

const prisma = require('../lib/prisma')
const { extractMenuPlan, extractMenuPlanFromText } = require('../services/menuImport')
const { importToDatabase } = require('../services/menuImport/importToDatabase')
const { parsePrice } = require('../services/menuImport/price')
const { importCombos } = require('../services/combos/importCombos')

const MAX_ENTRIES_PER_IMPORT = 2000

/** POST /api/restaurant/menu-import/extract */
const extract = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' })
  }

  const result = await extractMenuPlan({
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
    size: req.file.size,
    originalname: req.file.originalname,
  })

  if (!result.ok) {
    // `internal` is logged, never returned — it can carry stack details.
    if (result.internal) {
      console.error('[menu-import] extraction failed:', result.internal)
    }
    return res.status(422).json({
      error: result.message,
      code: result.code,
      details: result.details,
    })
  }

  return res.json({
    plan: result.plan,
    combos: result.combos ?? [],
    meta: result.meta,
    partial: result.partial,
  })
}

/**
 * POST /api/restaurant/menu-import/extract-text
 *
 * The same review-then-confirm flow for text pasted into the browser. Writes
 * nothing, exactly like /extract.
 */
const extractText = async (req, res) => {
  const result = await extractMenuPlanFromText(req.body && req.body.text)

  if (!result.ok) {
    if (result.internal) {
      console.error('[menu-import] text extraction failed:', result.internal)
    }
    return res.status(422).json({
      error: result.message,
      code: result.code,
      details: result.details,
    })
  }

  return res.json({
    plan: result.plan,
    combos: result.combos ?? [],
    meta: result.meta,
    partial: result.partial,
  })
}

/** POST /api/restaurant/menu-import/commit */
const commit = async (req, res) => {
  // Authorisation comes from the session, never from the request body.
  const restaurantId = req.user.restaurantId
  if (!restaurantId) {
    return res.status(403).json({ error: 'This account is not linked to a restaurant.' })
  }

  const entries = Array.isArray(req.body.entries) ? req.body.entries : []
  const combos = Array.isArray(req.body.combos) ? req.body.combos : []

  if (entries.length === 0 && combos.length === 0) {
    return res.status(400).json({ error: 'No entries were selected for import.' })
  }

  if (combos.length > 100) {
    return res.status(413).json({ error: 'Too many combos in one import.' })
  }

  // A guard against a runaway request, not a limit on real menus. The Taj
  // menu alone parses to 655 dishes across 40 categories, so 500 refused an
  // ordinary restaurant's whole card. The message says both numbers, because
  // "too many" without a count tells the admin nothing about what to do.
  if (entries.length > MAX_ENTRIES_PER_IMPORT) {
    return res.status(413).json({
      error:
        `${entries.length} dishes in one import is more than this can take at once ` +
        `(the limit is ${MAX_ENTRIES_PER_IMPORT}). Import them in two goes.`,
    })
  }

  // Re-validate every entry server-side. The browser sent these back, so
  // nothing it says about prices or names is trusted.
  const clean = []
  for (const entry of entries) {
    const checked = sanitiseEntry(entry)
    if (!checked.ok) {
      return res.status(400).json({ error: checked.message })
    }
    clean.push(checked.entry)
  }

  try {
    const report = clean.length > 0
      ? await importToDatabase({ prisma, restaurantId, entries: clean })
      : {
          created: [], updated: [], unchanged: [], categoriesCreated: [],
          portionsCreated: 0, portionsUpdated: 0,
        }

    const comboReport = await importCombos({ prisma, restaurantId, combos })

    return res.json({
      report,
      comboReport,
      summary: {
        created: report.created.length,
        updated: report.updated.length,
        unchanged: report.unchanged.length,
        categoriesCreated: report.categoriesCreated.length,
        portionsCreated: report.portionsCreated,
        portionsUpdated: report.portionsUpdated,
        combosCreated: comboReport.created.length,
        combosUpdated: comboReport.updated.length,
        combosRejected: comboReport.rejected.length,
      },
    })
  } catch (err) {
    console.error('[menu-import] commit failed:', err)
    return res.status(500).json({ error: 'The import could not be saved. No changes were made.' })
  }
}

function sanitiseEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, message: 'An entry was malformed.' }
  }

  const name = typeof entry.name === 'string' ? entry.name.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > 200) {
    return { ok: false, message: 'An entry had a missing or invalid name.' }
  }

  const categoryName =
    typeof entry.categoryName === 'string' && entry.categoryName.trim()
      ? entry.categoryName.trim().replace(/\s+/g, ' ').slice(0, 200)
      : null

  const portions = []
  if (Array.isArray(entry.portions)) {
    if (entry.portions.length > 12) {
      return { ok: false, message: `"${name}" has too many portions.` }
    }
    for (const portion of entry.portions) {
      const label =
        portion && typeof portion.portion === 'string' ? portion.portion.trim() : ''
      const price = parsePrice(portion && portion.price)
      if (!label || !price.ok) {
        return { ok: false, message: `"${name}" has an unreadable portion or price.` }
      }
      portions.push({ portion: label.slice(0, 100), price: price.value })
    }
  }

  // FoodItem.price is NOT NULL, so every entry needs a usable base price.
  let price = null
  if (portions.length > 0) {
    price = Math.min(...portions.map((p) => p.price))
  } else {
    const parsed = parsePrice(entry.price)
    if (!parsed.ok) {
      return { ok: false, message: `"${name}" has no readable price.` }
    }
    price = parsed.value
  }

  // Only a real boolean passes. Anything else leaves the dish's existing value
  // alone rather than asserting a diet the menu never stated - and a wrong
  // vegetarian mark is the error that actually matters to a diner.
  const isVeg = typeof entry.isVeg === 'boolean' ? entry.isVeg : null

  return { ok: true, entry: { name, categoryName, price, portions, isVeg } }
}

/**
 * GET /api/restaurant/menu-import/summary
 * What a clear would remove. Read-only.
 */
const summary = async (req, res) => {
  const restaurantId = req.user.restaurantId
  if (!restaurantId) {
    return res.status(403).json({ error: 'This account is not linked to a restaurant.' })
  }

  const [dishes, categories, combos] = await Promise.all([
    prisma.foodItem.count({ where: { restaurantId } }),
    prisma.category.count({ where: { restaurantId } }),
    prisma.combo.count({ where: { restaurantId } }),
  ])

  return res.json({ dishes, categories, combos })
}

/**
 * DELETE /api/restaurant/menu-import/all
 *
 * Empties this restaurant's menu: dishes, their portions, categories and
 * combos. Deliberately destructive and deliberately narrow - the restaurant
 * comes from the session, never from the request, so no account can clear
 * another's menu. There is no undo, which is why the browser asks first and
 * why what was removed is logged and returned.
 */
const clearMenu = async (req, res) => {
  const restaurantId = req.user.restaurantId
  if (!restaurantId) {
    return res.status(403).json({ error: 'This account is not linked to a restaurant.' })
  }

  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Clearing the menu has to be confirmed.' })
  }

  try {
    const removed = await prisma.$transaction(async (tx) => {
      // Portions and combo lines go with their parents by cascade.
      const dishes = await tx.foodItem.deleteMany({ where: { restaurantId } })
      const categories = await tx.category.deleteMany({ where: { restaurantId } })
      const combos = await tx.combo.deleteMany({ where: { restaurantId } })
      return { dishes: dishes.count, categories: categories.count, combos: combos.count }
    }, { maxWait: 15000, timeout: 5 * 60 * 1000 })

    console.warn(
      `[menu-import] menu cleared for restaurant ${restaurantId}: ` +
        `${removed.dishes} dishes, ${removed.categories} categories, ${removed.combos} combos`,
    )

    return res.json({ removed })
  } catch (err) {
    console.error('[menu-import] clear failed:', err)
    return res.status(500).json({ error: 'The menu could not be cleared. Nothing was removed.' })
  }
}

module.exports = { extract, extractText, commit, summary, clearMenu }
