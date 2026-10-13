'use strict'

/**
 * Turning a typed question into a safe menu filter.
 *
 * Nothing here touches the database and nothing here writes. The output is a
 * plain description of what to look for, which the query layer then runs as a
 * read.
 *
 * Two routes produce a filter:
 *
 *   readQuestion()   rules over the words in the question. Instant, and it
 *                    covers the common phrasings ("under 250", "vegan",
 *                    "cheapest"). No model, so no waiting.
 *
 *   sanitiseFilter() the model's JSON, stripped to known fields with every
 *                    number clamped. The model is never trusted to name a
 *                    column or to supply a price.
 *
 * Why a closed field list: a question is untrusted text. If the model could
 * name arbitrary fields or operators, a question would become a query against
 * the database. It cannot - anything not listed here is discarded.
 */

/** The only fields a question can filter on. */
const ALLOWED = {
  maxPrice: 'number',
  minPrice: 'number',
  isVeg: 'boolean',
  isVegan: 'boolean',
  isJain: 'boolean',
  isGlutenFree: 'boolean',
  maxSpicy: 'number',
  minSpicy: 'number',
  maxCalories: 'number',
  category: 'string',
  nameContains: 'string',
  availableOnly: 'boolean',
  sort: 'sort',
  limit: 'number',
}

const SORTS = ['price_asc', 'price_desc', 'name', 'spicy_asc', 'spicy_desc']

const PRICE_CEILING = 100000
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 25

function clampNumber(value, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.min(Math.round(n * 100) / 100, max)
}

function cleanText(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, 60)
  return trimmed === '' ? undefined : trimmed
}

/**
 * Keep only known fields, with every value coerced and bounded.
 * @param {object} raw  parsed JSON from the model, or anything at all
 */
function sanitiseFilter(raw) {
  const filter = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return filter

  for (const [key, kind] of Object.entries(ALLOWED)) {
    if (!(key in raw)) continue
    const value = raw[key]

    if (kind === 'boolean') {
      if (typeof value === 'boolean') filter[key] = value
    } else if (kind === 'number') {
      const max = key === 'limit' ? MAX_LIMIT : key === 'maxCalories' ? 20000 : PRICE_CEILING
      const n = clampNumber(value, max)
      if (n !== undefined) filter[key] = n
    } else if (kind === 'sort') {
      if (SORTS.includes(value)) filter[key] = value
    } else {
      const text = cleanText(value)
      if (text !== undefined) filter[key] = text
    }
  }

  // Spice level is 0-4 in the schema.
  if (filter.maxSpicy !== undefined) filter.maxSpicy = Math.min(filter.maxSpicy, 4)
  if (filter.minSpicy !== undefined) filter.minSpicy = Math.min(filter.minSpicy, 4)

  // A reversed range matches nothing and is more likely a mistake than a
  // request, so drop the weaker bound rather than return an empty menu.
  if (filter.minPrice !== undefined && filter.maxPrice !== undefined &&
      filter.minPrice > filter.maxPrice) {
    delete filter.minPrice
  }

  return filter
}

/* ------------------------------------------------------------------ rules */

const UNDER = /(?:under|below|less than|cheaper than|upto|up to|within|max(?:imum)?|≤|<=?)\s*(?:rs\.?|₹)?\s*(\d{2,5})/i
const OVER = /(?:over|above|more than|greater than|at least|min(?:imum)?|≥|>=?)\s*(?:rs\.?|₹)?\s*(\d{2,5})/i
const BETWEEN = /between\s*(?:rs\.?|₹)?\s*(\d{2,5})\s*(?:and|to|-|–)\s*(?:rs\.?|₹)?\s*(\d{2,5})/i

/** Lowercase, punctuation out, single spaces: so "Non-Veg" meets "non veg". */
function flatten(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Does `haystack` contain `needle` as whole words rather than mid-word? */
function containsWords(haystack, needle) {
  const at = haystack.indexOf(needle)
  if (at === -1) return false
  const before = at === 0 || haystack[at - 1] === ' '
  const afterIndex = at + needle.length
  const after = afterIndex === haystack.length || haystack[afterIndex] === ' '
  return before && after
}

/**
 * Read a question with rules alone.
 *
 * @param {string} question
 * @param {string[]} [knownCategories]  category names from the menu, so a
 *   question naming a real section filters by it rather than by dish name
 * @returns {{filter: object, matched: string[]}} matched lists what was
 *   recognised, so the caller can tell a understood question from a shrug
 */
function readQuestion(question, knownCategories = []) {
  const text = String(question || '').toLowerCase()
  const filter = {}
  const matched = []

  const between = text.match(BETWEEN)
  if (between) {
    const a = Number(between[1])
    const b = Number(between[2])
    filter.minPrice = Math.min(a, b)
    filter.maxPrice = Math.max(a, b)
    matched.push('price range')
  } else {
    const under = text.match(UNDER)
    if (under) {
      filter.maxPrice = Number(under[1])
      matched.push('max price')
    }
    const over = text.match(OVER)
    if (over) {
      filter.minPrice = Number(over[1])
      matched.push('min price')
    }
  }

  // Order matters: "non veg" contains "veg".
  if (/\bnon[\s-]?veg\b|\bnonveg\b|\bnon vegetarian\b/.test(text)) {
    filter.isVeg = false
    matched.push('non-veg')
  } else if (/\bvegan\b/.test(text)) {
    filter.isVegan = true
    matched.push('vegan')
  } else if (/\bveg\b|\bvegetarian\b/.test(text)) {
    filter.isVeg = true
    matched.push('veg')
  }

  if (/\bjain\b/.test(text)) { filter.isJain = true; matched.push('jain') }
  if (/gluten[\s-]?free/.test(text)) { filter.isGlutenFree = true; matched.push('gluten free') }

  if (/\bnot (?:too )?spicy\b|\bmild\b|\bless spicy\b/.test(text)) {
    filter.maxSpicy = 1
    matched.push('mild')
  } else if (/\bspicy\b|\bhot\b/.test(text)) {
    filter.minSpicy = 2
    matched.push('spicy')
  }

  if (/\bcheapest\b|\blowest price\b|\bmost affordable\b/.test(text)) {
    filter.sort = 'price_asc'
    filter.limit = 5
    matched.push('cheapest')
  } else if (/\bcostliest\b|\bmost expensive\b|\bhighest price\b|\bpriciest\b/.test(text)) {
    filter.sort = 'price_desc'
    filter.limit = 5
    matched.push('most expensive')
  }

  // A named section of the real menu beats guessing at the dish name.
  //
  // The LONGEST matching name wins, and punctuation is ignored on both sides.
  // "Veg Starters" is a substring of "non veg starters", so taking the first
  // match sent a question about non-vegetarian starters to the vegetarian
  // section - which is how a question about starters returned Black Forest
  // cake. Hyphens differ too: the menu prints "Non-Veg Starters" and people
  // type "non veg starters".
  const flat = flatten(text)
  let bestCategory = null

  for (const name of knownCategories) {
    const clean = flatten(name)
    if (clean.length < 3) continue
    if (!containsWords(flat, clean)) continue
    if (!bestCategory || clean.length > flatten(bestCategory).length) bestCategory = name
  }

  if (bestCategory) {
    filter.category = bestCategory
    matched.push('category')

    // The section already says what it holds, so do not also filter on the
    // dietary flag. Imported dishes have no veg/non-veg data - the column
    // defaults to false - so filtering on it would hide most of the section.
    const categoryFlat = flatten(bestCategory)
    if (/\bnon veg\b|\bnonveg\b/.test(categoryFlat)) delete filter.isVeg
    else if (/\bveg\b|\bvegetarian\b/.test(categoryFlat)) delete filter.isVeg
  } else {
    const food = text.match(
      /\b(chicken|mutton|paneer|fish|prawn|egg|biryani|mandi|soup|starters?|desserts?|rotis?|naan|rice|noodles?|grill|tandoori|kebabs?|barbeque|bbq|shakes?|lassi|mojito|cakes?|ice cream|coffee|juice)\b/,
    )
    if (food) {
      // Search the singular: "starters" is stored as "Starter" often enough.
      filter.nameContains = food[1].replace(/s$/, '')
      matched.push('dish word')
    }
  }

  return { filter, matched }
}

/** Fill in the defaults a query needs but a question rarely states. */
function withDefaults(filter) {
  return {
    availableOnly: true,
    limit: DEFAULT_LIMIT,
    ...filter,
  }
}

module.exports = {
  flatten,
  containsWords,
  sanitiseFilter,
  readQuestion,
  withDefaults,
  ALLOWED,
  SORTS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
}
