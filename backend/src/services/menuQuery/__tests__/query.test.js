'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildWhere, buildOrderBy } = require('../runQuery')
const { buildAnswer, describeFilter, priceLabel, money } = require('../answer')

/** Prisma returns Decimal objects, not numbers. */
function decimal(n) {
  return { toNumber: () => n }
}

/* -------------------------------------------------------------- the where */

test('buildWhere always scopes to the restaurant from the session', () => {
  const where = buildWhere('rest-1', {})
  assert.equal(where.restaurantId, 'rest-1')
})

test('buildWhere refuses to run without a restaurant', () => {
  // Without this, a missing session would query every restaurant's menu.
  assert.throws(() => buildWhere(undefined, { maxPrice: 100 }), /restaurantId is required/)
  assert.throws(() => buildWhere('', {}), /restaurantId is required/)
})

test('buildWhere hides unavailable dishes by default', () => {
  assert.equal(buildWhere('r', {}).isAvailable, true)
  assert.equal(buildWhere('r', { availableOnly: false }).isAvailable, undefined)
})

test('buildWhere turns price bounds into a range', () => {
  assert.deepEqual(buildWhere('r', { maxPrice: 250 }).price, { lte: 250 })
  assert.deepEqual(buildWhere('r', { minPrice: 100 }).price, { gte: 100 })
  assert.deepEqual(buildWhere('r', { minPrice: 100, maxPrice: 250 }).price, { gte: 100, lte: 250 })
  assert.equal(buildWhere('r', {}).price, undefined, 'no bound means no price condition')
})

test('buildWhere passes dietary flags through as given', () => {
  assert.equal(buildWhere('r', { isVegan: true }).isVegan, true)
  assert.equal(buildWhere('r', { isVeg: false }).isVeg, false)
  assert.equal(buildWhere('r', {}).isVeg, undefined, 'absent means no filter, not false')
})

test('buildWhere matches category and name case-insensitively', () => {
  assert.deepEqual(buildWhere('r', { category: 'Biryani' }).category,
    { name: { contains: 'Biryani', mode: 'insensitive' } })
  assert.deepEqual(buildWhere('r', { nameContains: 'chicken' }).name,
    { contains: 'chicken', mode: 'insensitive' })
})

test('buildOrderBy falls back to the menu order for an unknown sort', () => {
  assert.deepEqual(buildOrderBy({ sort: 'price_asc' }), [{ price: 'asc' }, { name: 'asc' }])
  assert.deepEqual(buildOrderBy({ sort: 'nonsense' }), [{ sortOrder: 'asc' }, { name: 'asc' }])
  assert.deepEqual(buildOrderBy({}), [{ sortOrder: 'asc' }, { name: 'asc' }])
})

/* ------------------------------------------------------------- the answer */

test('money reads a Prisma Decimal as well as a plain number', () => {
  assert.equal(money(decimal(220)), '₹220')
  assert.equal(money(249.5), '₹249.50')
  assert.equal(money('180'), '₹180')
  assert.equal(money(null), '-')
})

test('priceLabel shows portion prices when a dish has them', () => {
  assert.equal(priceLabel({ price: decimal(150), portions: [] }), '₹150')
  assert.equal(
    priceLabel({ price: decimal(150), portions: [
      { portion: 'Quarter', price: decimal(150), isAvailable: true },
      { portion: 'Full', price: decimal(440), isAvailable: true },
    ] }),
    'Quarter ₹150, Full ₹440',
  )
})

test('an empty result says so plainly instead of implying a failure', () => {
  const answer = buildAnswer({ items: [], total: 0 }, { isVegan: true, maxPrice: 100 })
  assert.equal(answer.count, 0)
  assert.equal(answer.empty, true)
  assert.match(answer.headline, /^No vegan dishes under ₹100 on the menu\./)
})

test('the answer lists dishes with prices taken from the rows', () => {
  const result = {
    items: [
      { name: 'Veg Soup', price: decimal(90), isVeg: true, spicyLevel: 0,
        category: { name: 'Soup' }, portions: [] },
      { name: 'Paneer Tikka', price: decimal(230), isVeg: true, spicyLevel: 3,
        category: { name: 'Tandoori' }, portions: [] },
    ],
    total: 2,
  }

  const answer = buildAnswer(result, { isVeg: true, maxPrice: 250 })
  assert.equal(answer.count, 2)
  assert.match(answer.headline, /^2 vegetarian dishes under ₹250:/)
  assert.equal(answer.lines[0], 'Veg Soup — ₹90 · Soup [veg]')
  assert.equal(answer.lines[1], 'Paneer Tikka — ₹230 · Tandoori [veg, spicy]')
})

test('the answer says when more dishes matched than it is showing', () => {
  const items = Array.from({ length: 3 }, (_, i) => ({
    name: 'Dish ' + i, price: decimal(100), spicyLevel: 0, portions: [],
  }))
  const answer = buildAnswer({ items, total: 17 }, {})
  assert.match(answer.headline, /^17 dishes\. Showing the first 3:/)
})

test('describeFilter words non-veg correctly rather than dropping it', () => {
  assert.match(describeFilter({ isVeg: false }), /non-vegetarian/)
  assert.match(describeFilter({ isVegan: true }), /vegan/)
  assert.match(describeFilter({ isJain: true, isGlutenFree: true }), /Jain, gluten-free/)
  assert.match(describeFilter({ category: 'Soup', maxPrice: 120 }), /in Soup under ₹120/)
})
