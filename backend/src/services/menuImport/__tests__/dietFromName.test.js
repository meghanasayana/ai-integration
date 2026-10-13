'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { inferDiet } = require('../dietFromName')

test('a meat word in the name means non-vegetarian', () => {
  for (const name of [
    'Chicken 65 Bone (8 Pcs)', 'Mutton Rogan Josh', 'Fish Mandi',
    'Prawn Dum Biryani', 'Egg Dum Biryani', 'Bread Omelette',
  ]) {
    assert.equal(inferDiet(name).isVeg, false, name)
  }
})

test('a meat word wins even under a vegetarian-sounding section', () => {
  // A wrong "vegetarian" mark is the error that matters, so meat is absolute.
  assert.equal(inferDiet('Chicken Tikka', 'Veg Starters').isVeg, false)
  assert.equal(inferDiet('Egg Fried Rice', 'Desserts').isVeg, false)
})

test('a vegetarian word in the name means vegetarian', () => {
  for (const name of ['Paneer Mandi', 'Mango Lassi', 'Virgin Mojito', 'Gulab Jamun (2 Pcs)']) {
    assert.equal(inferDiet(name).isVeg, true, name)
  }
})

test('the section decides when the name says nothing', () => {
  // "Black Forest" and "Vanilla" mean nothing alone. Their sections do.
  assert.equal(inferDiet('Black Forest').isVeg, null)
  assert.equal(inferDiet('Black Forest', 'Cakes').isVeg, true)
  assert.equal(inferDiet('Vanilla', 'Ice Cream').isVeg, true)
  assert.equal(inferDiet('Death By Chocolate', 'Ice Cream').isVeg, true)
})

test('a section containing a meat word tells us nothing about one dish', () => {
  // "Non-Veg Starters" holds meat, but which dish is which is not this
  // function's business - and the section word must not read as "veg".
  assert.equal(inferDiet('Dragon Special', 'Non-Veg Starters').isVeg, null)
  assert.equal(inferDiet('House Special', 'Chicken Main Course').isVeg, null)
})

test('an unclear name and an unclear section stay unset', () => {
  // null means the importer leaves the dish alone, which is the whole point:
  // the menu never stated a diet and nor will we.
  assert.equal(inferDiet('Plain Dum Biryani').isVeg, null)
  assert.equal(inferDiet('House Platter', 'Chef Specials').isVeg, null)
  assert.equal(inferDiet('').isVeg, null)
  assert.equal(inferDiet(null).isVeg, null)
})

test('a word inside a longer word does not count', () => {
  // "Vegas" is not "veg"; whole-word matching only.
  assert.equal(inferDiet('Vegas Platter').isVeg, null)
  assert.equal(inferDiet('Chickenless Wrap').isVeg, null)
})

test('the reason is reported so the decision can be checked', () => {
  assert.equal(inferDiet('Chicken Masala').reason, 'meat:chicken')
  assert.equal(inferDiet('Paneer Tikka').reason, 'veg:paneer')
  assert.equal(inferDiet('Vanilla', 'Ice Cream').reason, 'section:ice cream')
  assert.equal(inferDiet('Plain Rice Bowl').reason, null)
})

test('a negated section never reads as vegetarian', () => {
  // "Non-Veg Starters" contains the phrase "veg starters". Matching section
  // names by phrase marked the entire non-vegetarian section vegetarian - the
  // one error here that actually harms someone.
  for (const section of ['Non-Veg Starters', 'Non Veg Starters', 'NonVeg', 'Non-Vegetarian']) {
    const result = inferDiet('House Special', section)
    assert.notEqual(result.isVeg, true, section + ' must never read as vegetarian')
    assert.equal(result.isVeg, null, section)
  }

  // And a dish whose own name is clear is still decided by the name.
  assert.equal(inferDiet('Paneer Tikka', 'Non-Veg Starters').isVeg, true)
  assert.equal(inferDiet('Chicken Tikka', 'Non-Veg Starters').isVeg, false)
})
