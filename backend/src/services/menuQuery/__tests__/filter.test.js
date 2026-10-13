'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { sanitiseFilter, readQuestion, withDefaults } = require('../filter')

/* ----------------------------------------------------- reading a question */

test('reads a price ceiling from several phrasings', () => {
  for (const q of [
    'foods under 250',
    'anything below 250',
    'dishes less than 250',
    'show me items upto 250',
    'what is cheaper than 250',
    'under rs 250',
    'under ₹250',
  ]) {
    assert.equal(readQuestion(q).filter.maxPrice, 250, 'failed on: ' + q)
  }
})

test('reads a price range', () => {
  const { filter } = readQuestion('dishes between 100 and 200')
  assert.equal(filter.minPrice, 100)
  assert.equal(filter.maxPrice, 200)
})

test('distinguishes veg, vegan and non-veg', () => {
  assert.equal(readQuestion('what all are vegan').filter.isVegan, true)
  assert.equal(readQuestion('show veg items').filter.isVeg, true)
  assert.equal(readQuestion('vegetarian dishes').filter.isVeg, true)
  // "non veg" contains "veg": the order of these checks is what makes this
  // work, and getting it wrong would show diners vegetarian food instead.
  assert.equal(readQuestion('non veg starters').filter.isVeg, false)
  assert.equal(readQuestion('non-veg').filter.isVeg, false)
  assert.equal(readQuestion('nonveg items').filter.isVeg, false)
})

test('reads dietary flags and spice level', () => {
  assert.equal(readQuestion('jain food').filter.isJain, true)
  assert.equal(readQuestion('gluten free options').filter.isGlutenFree, true)
  assert.equal(readQuestion('gluten-free').filter.isGlutenFree, true)
  assert.equal(readQuestion('something not too spicy').filter.maxSpicy, 1)
  assert.equal(readQuestion('mild dishes').filter.maxSpicy, 1)
  assert.equal(readQuestion('spicy chicken').filter.minSpicy, 2)
})

test('reads cheapest and most expensive as a sort, not a price', () => {
  const cheap = readQuestion('what is the cheapest dish').filter
  assert.equal(cheap.sort, 'price_asc')
  assert.equal(cheap.limit, 5)
  assert.equal(cheap.maxPrice, undefined, 'must not invent a price bound')

  assert.equal(readQuestion('most expensive item').filter.sort, 'price_desc')
})

test('prefers a real category over guessing at the dish name', () => {
  const withCategory = readQuestion('show me the biryani section', ['Biryani', 'Soup'])
  assert.equal(withCategory.filter.category, 'Biryani')
  assert.equal(withCategory.filter.nameContains, undefined)

  // With no such category, the word is treated as part of a dish name.
  const withoutCategory = readQuestion('biryani please', [])
  assert.equal(withoutCategory.filter.nameContains, 'biryani')
})

test('combines conditions from one question', () => {
  const { filter } = readQuestion('veg starters under 200 that are not too spicy', ['Starters'])
  assert.equal(filter.isVeg, true)
  assert.equal(filter.maxPrice, 200)
  assert.equal(filter.maxSpicy, 1)
  assert.equal(filter.category, 'Starters')
})

test('reports nothing matched for a question it cannot read', () => {
  const { filter, matched } = readQuestion('who owns this restaurant')
  assert.deepEqual(filter, {})
  assert.equal(matched.length, 0)
})

/* ------------------------------------------------ sanitising model output */

test('sanitiseFilter keeps known fields and drops everything else', () => {
  const filter = sanitiseFilter({
    maxPrice: 250,
    isVegan: true,
    sort: 'price_asc',
    // None of these are fields a question may filter on.
    restaurantId: 'someone-elses-restaurant',
    isAvailable: false,
    rawSql: 'DROP TABLE food_items',
    select: '*',
    where: { id: 'x' },
  })

  assert.deepEqual(filter, { maxPrice: 250, isVegan: true, sort: 'price_asc' })
})

test('sanitiseFilter rejects an unknown sort rather than passing it through', () => {
  assert.equal(sanitiseFilter({ sort: 'price_asc; DROP TABLE food_items' }).sort, undefined)
  assert.equal(sanitiseFilter({ sort: 'random' }).sort, undefined)
  assert.equal(sanitiseFilter({ sort: 'price_desc' }).sort, 'price_desc')
})

test('sanitiseFilter bounds numbers and ignores nonsense', () => {
  assert.equal(sanitiseFilter({ limit: 9999 }).limit, 50)
  assert.equal(sanitiseFilter({ maxPrice: -5 }).maxPrice, undefined)
  assert.equal(sanitiseFilter({ maxPrice: 'cheap' }).maxPrice, undefined)
  assert.equal(sanitiseFilter({ maxSpicy: 99 }).maxSpicy, 4)
})

test('sanitiseFilter only accepts real booleans', () => {
  assert.equal(sanitiseFilter({ isVeg: 'yes' }).isVeg, undefined)
  assert.equal(sanitiseFilter({ isVeg: 1 }).isVeg, undefined)
  assert.equal(sanitiseFilter({ isVeg: false }).isVeg, false, 'false means non-veg, not absent')
})

test('sanitiseFilter drops a reversed price range instead of matching nothing', () => {
  const filter = sanitiseFilter({ minPrice: 500, maxPrice: 100 })
  assert.equal(filter.maxPrice, 100)
  assert.equal(filter.minPrice, undefined)
})

test('sanitiseFilter survives junk input', () => {
  for (const junk of [null, undefined, 'text', 42, [], [{ maxPrice: 1 }]]) {
    assert.deepEqual(sanitiseFilter(junk), {})
  }
})

test('withDefaults hides unavailable dishes unless asked otherwise', () => {
  assert.equal(withDefaults({}).availableOnly, true)
  assert.equal(withDefaults({}).limit, 25)
  assert.equal(withDefaults({ availableOnly: false }).availableOnly, false)
})

/* --------------- matching the right section of the menu ------------------ */

const CATEGORIES = [
  'Non-Veg Starters', 'Veg Starters', 'Tandoori Starters',
  'Cakes', 'Desserts', 'Ice Cream', 'Biryani', 'Mojito',
]

test('a question about non-veg starters does not match the veg section', () => {
  // The reported bug: "Veg Starters" is a substring of "non veg starters", so
  // taking the first matching category searched the VEGETARIAN section - which
  // is how asking for non-veg starters returned Black Forest cake.
  for (const q of ['Non veg starters', 'non-veg starters', 'NON VEG STARTERS']) {
    const { filter } = readQuestion(q, CATEGORIES)
    assert.equal(filter.category, 'Non-Veg Starters', q)
  }

  const veg = readQuestion('veg starters', CATEGORIES)
  assert.equal(veg.filter.category, 'Veg Starters')
})

test('the longest matching section wins', () => {
  assert.equal(readQuestion('tandoori starters', CATEGORIES).filter.category, 'Tandoori Starters')
  assert.equal(readQuestion('ice cream please', CATEGORIES).filter.category, 'Ice Cream')
})

test('punctuation and spacing differences still match', () => {
  // The menu prints "Non-Veg Starters"; people type it however they like.
  assert.equal(readQuestion('non  veg   starters', CATEGORIES).filter.category, 'Non-Veg Starters')
})

test('a matched section does not also filter on the dietary flag', () => {
  // The section already says what it holds, and imported dishes have no
  // reliable veg data - so adding isVeg would hide most of the section.
  const { filter } = readQuestion('non veg starters', CATEGORIES)
  assert.equal(filter.isVeg, undefined)

  const vegSection = readQuestion('veg starters', CATEGORIES)
  assert.equal(vegSection.filter.isVeg, undefined)

  // Without a section, the dietary word still applies.
  assert.equal(readQuestion('non veg dishes', CATEGORIES).filter.isVeg, false)
})

test('a plural dish word matches the singular stored name', () => {
  assert.equal(readQuestion('starters', []).filter.nameContains, 'starter')
  assert.equal(readQuestion('desserts', []).filter.nameContains, 'dessert')
  assert.equal(readQuestion('shakes', []).filter.nameContains, 'shake')
})
