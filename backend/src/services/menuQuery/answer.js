'use strict'

/**
 * Wording the answer.
 *
 * Every number and name in the reply comes from the database rows, never from
 * a model. The model's only job upstream is deciding what to look for; it does
 * not get to say what the menu contains, because a confidently worded wrong
 * price is the one failure a diner or an owner would act on.
 */

/** Prisma Decimal, number or string -> a plain number. */
function toNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (typeof value.toNumber === 'function') return value.toNumber()
  return Number(value)
}

function money(value) {
  const n = toNumber(value)
  if (n === null || !Number.isFinite(n)) return '-'
  return '₹' + (Number.isInteger(n) ? String(n) : n.toFixed(2))
}

/** A dish's price, or its portion prices when it has them. */
function priceLabel(item) {
  const portions = (item.portions || []).filter((p) => p.isAvailable !== false)
  if (portions.length > 0) {
    return portions.map((p) => `${p.portion} ${money(p.price)}`).join(', ')
  }
  return money(item.price)
}

/** Describe the filter in words, so the answer states what it searched for. */
function describeFilter(filter) {
  const parts = []
  const f = filter || {}

  if (f.isVegan) parts.push('vegan')
  else if (f.isVeg === true) parts.push('vegetarian')
  else if (f.isVeg === false) parts.push('non-vegetarian')

  if (f.isJain) parts.push('Jain')
  if (f.isGlutenFree) parts.push('gluten-free')

  let noun = parts.length > 0 ? parts.join(', ') + ' dishes' : 'dishes'

  if (f.category) noun += ` in ${f.category}`
  if (f.nameContains) noun += ` matching "${f.nameContains}"`

  if (f.minPrice !== undefined && f.maxPrice !== undefined) {
    noun += ` between ${money(f.minPrice)} and ${money(f.maxPrice)}`
  } else if (f.maxPrice !== undefined) {
    noun += ` under ${money(f.maxPrice)}`
  } else if (f.minPrice !== undefined) {
    noun += ` over ${money(f.minPrice)}`
  }

  if (f.maxSpicy !== undefined && f.maxSpicy <= 1) noun += ', mild'
  if (f.minSpicy !== undefined && f.minSpicy >= 2) noun += ', spicy'

  return noun
}

/**
 * @param {object} result  from runQuery
 * @param {object} filter  the sanitised filter used
 * @returns {{headline: string, lines: string[], count: number}}
 */
function buildAnswer(result, filter) {
  const items = (result && result.items) || []
  const total = result && typeof result.total === 'number' ? result.total : items.length
  const description = describeFilter(filter)

  if (items.length === 0) {
    return {
      headline: `No ${description} on the menu.`,
      lines: [],
      count: 0,
      // Said plainly: an empty result is a fact about the menu, not a failure
      // to understand the question.
      empty: true,
    }
  }

  const shown = items.length
  const headline =
    total > shown
      ? `${total} ${description}. Showing the first ${shown}:`
      : `${total} ${description}:`

  const lines = items.map((item) => {
    const tags = []
    if (item.isVegan) tags.push('vegan')
    else if (item.isVeg) tags.push('veg')
    if (item.isJain) tags.push('Jain')
    if (item.isGlutenFree) tags.push('GF')
    if (item.spicyLevel >= 3) tags.push('spicy')

    const category = item.category && item.category.name ? ` · ${item.category.name}` : ''
    const tagText = tags.length > 0 ? ` [${tags.join(', ')}]` : ''
    return `${item.name} — ${priceLabel(item)}${category}${tagText}`
  })

  return { headline, lines, count: total, empty: false }
}

module.exports = { buildAnswer, describeFilter, priceLabel, money, toNumber }
