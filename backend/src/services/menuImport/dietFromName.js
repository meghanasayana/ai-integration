'use strict'

/**
 * Working out whether a dish is vegetarian from its printed name.
 *
 * Why this exists: the import reads names and prices, not dietary data, and
 * the database column defaults to false. So every imported dish arrived marked
 * non-vegetarian - including Black Forest cake and mango lassi - and a
 * question about non-vegetarian starters returned desserts.
 *
 * This is an inference, not a fact the menu stated, and dietary information is
 * the kind people act on for religious and ethical reasons. So it is
 * deliberately timid:
 *
 *  - it answers only when a name contains an unmistakable word
 *  - a meat word always wins over a vegetarian one
 *  - anything it is unsure about returns null, and the importer then leaves the
 *    dish alone rather than asserting anything
 *  - every dish it does decide is flagged in the review list, so the decision
 *    is visible before it is saved
 *
 * Egg is treated as non-vegetarian, which is the convention on Indian menus.
 */

/** Unmistakably not vegetarian. */
const MEAT_WORDS = [
  'chicken', 'mutton', 'lamb', 'goat', 'beef', 'pork', 'bacon', 'ham',
  'fish', 'prawn', 'prawns', 'shrimp', 'crab', 'squid', 'calamari',
  'egg', 'eggs', 'omelette', 'omelet', 'keema', 'liver', 'brain',
  'meat', 'tandoori chicken', 'bbq chicken', 'faham', 'kheema',
]

/** Unmistakably vegetarian, including the drinks and desserts. */
const VEG_WORDS = [
  'veg', 'vegetable', 'vegetarian', 'paneer', 'tofu', 'soya',
  'aloo', 'potato', 'gobi', 'cauliflower', 'mushroom', 'corn', 'cheese',
  'dal', 'daal', 'chana', 'chole', 'rajma', 'palak', 'spinach',
  'bhindi', 'baingan', 'brinjal', 'jeera', 'tomato', 'kaju', 'malai kofta',
  'cake', 'brownie', 'pastry', 'ice cream', 'kulfi', 'falooda', 'halwa',
  'gulab jamun', 'rasmalai', 'rasgulla', 'jalebi', 'payasam', 'kheer',
  'lassi', 'juice', 'shake', 'smoothie', 'coffee', 'tea', 'chai',
  'mojito', 'soda', 'water', 'cola', 'lemonade', 'milk', 'fruit',
  'salad', 'roti', 'naan', 'paratha', 'chapati', 'kulcha', 'idli', 'dosa',
]

function flatten(name) {
  return ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '
}

/** Does the name contain this term as whole words? */
function hasTerm(flat, term) {
  return flat.includes(' ' + term + ' ')
}

function firstMatch(flat, terms) {
  for (const term of terms) {
    // Multi-word terms are checked as a phrase.
    if (term.includes(' ') ? flat.includes(' ' + term + ' ') : hasTerm(flat, term)) return term
  }
  return null
}

/**
 * Sections that are vegetarian as a whole. Used only when the dish name itself
 * says nothing: "Black Forest" and "Vanilla" mean nothing on their own, but
 * under Cakes and Ice Cream they are clear enough.
 */
const VEG_SECTIONS = [
  'cake', 'cakes', 'dessert', 'desserts', 'ice cream', 'sweets', 'sweet',
  'beverage', 'beverages', 'drink', 'drinks', 'bottled drinks', 'juice',
  'juices', 'shake', 'shakes', 'milk shake', 'milk shakes', 'lassi',
  'mojito', 'mojitos', 'lemon mint', 'hot beverages', 'soup',
  'veg starters', 'veg', 'indian breads', 'breads', 'fruit salad',
]

/**
 * @param {string} name
 * @param {string} [categoryName]  the section it sits under, as a second hint
 * @returns {{isVeg: boolean|null, reason: string|null}}
 */
function inferDiet(name, categoryName) {
  const flat = flatten(name)
  if (flat.trim() === '') return { isVeg: null, reason: null }

  // Meat first and unconditionally: a wrong "vegetarian" is the harmful error.
  const meat = firstMatch(flat, MEAT_WORDS)
  if (meat) return { isVeg: false, reason: 'meat:' + meat }

  const veg = firstMatch(flat, VEG_WORDS)
  if (veg) return { isVeg: true, reason: 'veg:' + veg }

  // Nothing in the name. A wholly vegetarian section is the next best thing,
  // but only when the section is not itself a negation.
  //
  // "Non-Veg Starters" contains the phrase "veg starters", so matching section
  // names by phrase marked every dish in the non-vegetarian section as
  // vegetarian. That is the one error here with real consequences, so the
  // negation is checked first and settles it.
  if (categoryName) {
    const section = flatten(categoryName)

    if (/\bnon\s*veg/.test(section) || /\bnon\s*vegetarian/.test(section)) {
      return { isVeg: null, reason: null }
    }

    if (!firstMatch(section, MEAT_WORDS)) {
      const match = firstMatch(section, VEG_SECTIONS)
      if (match) return { isVeg: true, reason: 'section:' + match }
    }
  }

  return { isVeg: null, reason: null }
}

module.exports = { inferDiet, MEAT_WORDS, VEG_WORDS, VEG_SECTIONS }
