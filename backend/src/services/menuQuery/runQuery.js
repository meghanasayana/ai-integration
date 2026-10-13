'use strict'

/**
 * Running a menu question against the database.
 *
 * READ ONLY. This module calls findMany and count and nothing else. There is
 * no create, update, delete or raw query anywhere in it, and the restaurant is
 * supplied by the caller from the signed-in session - never by the question, so
 * a question cannot reach another restaurant's menu.
 *
 * The filter arriving here has already been through filter.js, so every field
 * is known and every number bounded. This module's own job is to translate it
 * into Prisma's shape without widening it.
 */

const SORT_ORDERS = {
  price_asc: [{ price: 'asc' }, { name: 'asc' }],
  price_desc: [{ price: 'desc' }, { name: 'asc' }],
  name: [{ name: 'asc' }],
  spicy_asc: [{ spicyLevel: 'asc' }, { name: 'asc' }],
  spicy_desc: [{ spicyLevel: 'desc' }, { name: 'asc' }],
}

const DEFAULT_ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }]

/** Drop keys whose value is undefined, which Prisma would otherwise reject. */
function compact(object) {
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Build the Prisma `where` for a sanitised filter.
 * Exported on its own so it can be tested without a database.
 */
function buildWhere(restaurantId, filter) {
  if (!restaurantId) throw new Error('restaurantId is required')
  const f = filter || {}

  const priceRange = compact({ gte: f.minPrice, lte: f.maxPrice })
  const spiceRange = compact({ gte: f.minSpicy, lte: f.maxSpicy })

  return compact({
    // Always first and always from the session, never from the question.
    restaurantId,
    isAvailable: f.availableOnly === false ? undefined : true,
    price: Object.keys(priceRange).length > 0 ? priceRange : undefined,
    spicyLevel: Object.keys(spiceRange).length > 0 ? spiceRange : undefined,
    calories: f.maxCalories !== undefined ? { lte: f.maxCalories } : undefined,
    isVeg: f.isVeg,
    isVegan: f.isVegan,
    isJain: f.isJain,
    isGlutenFree: f.isGlutenFree,
    name: f.nameContains ? { contains: f.nameContains, mode: 'insensitive' } : undefined,
    category: f.category
      ? { name: { contains: f.category, mode: 'insensitive' } }
      : undefined,
  })
}

function buildOrderBy(filter) {
  return SORT_ORDERS[filter && filter.sort] || DEFAULT_ORDER
}

/**
 * @param {object} prisma         a Prisma client
 * @param {string} restaurantId   from the signed-in session
 * @param {object} filter         already sanitised by filter.js
 * @returns {Promise<{items: object[], total: number}>}
 */
async function runQuery(prisma, restaurantId, filter) {
  const where = buildWhere(restaurantId, filter)
  const take = Math.min(filter && filter.limit ? filter.limit : 25, 50)

  const [items, total] = await Promise.all([
    prisma.foodItem.findMany({
      where,
      orderBy: buildOrderBy(filter),
      take,
      select: {
        id: true,
        name: true,
        price: true,
        // The screen shows real dish cards, not a list of names, so the card's
        // own fields are read here rather than fetched again per result.
        imageUrl: true,
        description: true,
        isVeg: true,
        isVegan: true,
        isJain: true,
        isGlutenFree: true,
        spicyLevel: true,
        isAvailable: true,
        calories: true,
        allergens: true,
        category: { select: { name: true } },
        portions: {
          select: { portion: true, price: true, isAvailable: true },
          orderBy: { price: 'asc' },
        },
      },
    }),
    prisma.foodItem.count({ where }),
  ])

  return { items, total, truncated: total > items.length }
}

module.exports = { runQuery, buildWhere, buildOrderBy, SORT_ORDERS }
