'use strict'

/**
 * Writes a confirmed import plan to the database.
 *
 * This is the only file in menuImport/ that touches Prisma. Everything else
 * is pure. It runs AFTER the admin has reviewed the plan and chosen which
 * entries to keep.
 *
 * Rules, in priority order:
 *   1. Never delete. A dish missing from the uploaded menu is left alone.
 *   2. Never create a duplicate. Matching is by normalised name within the
 *      restaurant.
 *   3. Never touch fields the import did not supply — descriptions, images,
 *      dietary flags and IDs all survive an update untouched.
 *   4. Everything happens in one transaction, so a failure halfway leaves
 *      the menu exactly as it was.
 */

const { normaliseName } = require('./dishName')

/**
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.restaurantId  derived from the session, never the browser
 * @param {Array} params.entries        confirmed entries from the plan
 */
async function importToDatabase({ prisma, restaurantId, entries }) {
  if (!restaurantId) throw new Error('restaurantId is required')
  if (!Array.isArray(entries) || entries.length === 0) {
    return emptyReport()
  }

  // Current state, read once. Name matching happens in JS because the
  // normalisation rules (accents, punctuation, spacing) are ours, not SQL's.
  const [existingCategories, existingDishes] = await Promise.all([
    prisma.category.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
    prisma.foodItem.findMany({
      where: { restaurantId },
      select: { id: true, name: true, price: true, categoryId: true, portions: true },
    }),
  ])

  const categoryByName = new Map(
    existingCategories.map((c) => [normaliseName(c.name), c]),
  )
  const dishByName = new Map(existingDishes.map((d) => [normaliseName(d.name), d]))

  const report = emptyReport()

  // One transaction for the whole menu, so a failure half way leaves the menu
  // exactly as it was. Prisma closes an interactive transaction after five
  // seconds by default, which is nowhere near enough: a 13-page menu is 650
  // dishes, each needing its category looked up, the dish matched, and its
  // portions written. The import then failed with the transaction already
  // closed and the admin was told only that nothing was saved.
  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const categoryId = await ensureCategory(tx, {
        restaurantId,
        name: entry.categoryName,
        categoryByName,
        report,
      })

      const key = normaliseName(entry.name)
      const existing = dishByName.get(key)

      if (!existing) {
        const created = await tx.foodItem.create({
          data: {
            restaurantId,
            categoryId,
            name: entry.name,
            price: entry.price,
            isAvailable: true,
            // Only when the import worked it out; otherwise the column default
            // applies, rather than this asserting a diet from nothing.
            ...(typeof entry.isVeg === 'boolean' ? { isVeg: entry.isVeg } : {}),
          },
          select: {
            id: true, name: true, price: true, categoryId: true, portions: true, isVeg: true,
          },
        })
        dishByName.set(key, created)
        report.created.push({ id: created.id, name: created.name })

        await syncPortions(tx, created.id, [], entry.portions || [], report)
        continue
      }

      // Update only what the import actually knows about.
      const data = {}
      if (entry.price !== null && Number(existing.price) !== Number(entry.price)) {
        data.price = entry.price
      }
      if (categoryId && existing.categoryId !== categoryId) {
        data.categoryId = categoryId
      }
      // The diet of an existing dish is deliberately NOT touched.
      //
      // There is no column recording whether a person set it, so there is no
      // way to tell a human's decision from a previous default. Re-importing
      // must not quietly flip a flag someone set by hand, so an inference
      // applies only to a dish this import creates.

      const portionChanges = await syncPortions(
        tx,
        existing.id,
        existing.portions || [],
        entry.portions || [],
        report,
      )

      if (Object.keys(data).length === 0 && portionChanges === 0) {
        report.unchanged.push({ id: existing.id, name: existing.name })
        continue
      }

      if (Object.keys(data).length > 0) {
        await tx.foodItem.update({ where: { id: existing.id }, data })
      }
      report.updated.push({ id: existing.id, name: existing.name })
    }
  }, {
    maxWait: 15000,
    timeout: 10 * 60 * 1000,
  })

  return report
}

/**
 * Adds portions that are missing and corrects prices that changed.
 * Does NOT remove portions absent from the upload — a menu photo of one
 * section is not evidence that the other portions were discontinued.
 */
async function syncPortions(tx, foodItemId, current, incoming, report) {
  if (!incoming || incoming.length === 0) return 0

  const byName = new Map(current.map((p) => [normaliseName(p.portion), p]))
  let changes = 0

  for (const portion of incoming) {
    const existing = byName.get(normaliseName(portion.portion))

    if (!existing) {
      await tx.foodItemPortion.create({
        data: { foodItemId, portion: portion.portion, price: portion.price },
      })
      report.portionsCreated += 1
      changes += 1
      continue
    }

    if (Number(existing.price) !== Number(portion.price)) {
      await tx.foodItemPortion.update({
        where: { id: existing.id },
        data: { price: portion.price },
      })
      report.portionsUpdated += 1
      changes += 1
    }
  }

  return changes
}

async function ensureCategory(tx, { restaurantId, name, categoryByName, report }) {
  if (!name) return null

  const key = normaliseName(name)
  const existing = categoryByName.get(key)
  if (existing) return existing.id

  const created = await tx.category.create({
    data: { restaurantId, name: name.trim() },
    select: { id: true, name: true },
  })
  categoryByName.set(key, created)
  report.categoriesCreated.push(created.name)
  return created.id
}

function emptyReport() {
  return {
    created: [],
    updated: [],
    unchanged: [],
    categoriesCreated: [],
    portionsCreated: 0,
    portionsUpdated: 0,
  }
}

module.exports = { importToDatabase }
