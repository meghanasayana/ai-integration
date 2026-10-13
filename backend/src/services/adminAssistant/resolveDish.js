'use strict'

/**
 * Matching a spoken dish name to a real row.
 *
 * Takes the dish list as an argument rather than querying Prisma, so this is
 * pure, testable, and cannot touch the database.
 *
 * The rule that matters: when a name matches more than one dish, or matches
 * none exactly, the assistant NEVER picks one. It returns candidates and the
 * admin chooses. Acting on a guess here would silently change the wrong
 * dish's price.
 */

const { normaliseName, isSuspiciouslySimilar } = require('../menuImport/dishName')

/**
 * @param {string} spokenName
 * @param {Array<{id: string, name: string, categoryName?: string}>} dishes
 */
function resolveDish(spokenName, dishes) {
  const target = normaliseName(spokenName)

  if (!target) {
    return { status: 'not_found', candidates: [] }
  }

  const exact = dishes.filter((d) => normaliseName(d.name) === target)

  if (exact.length === 1) {
    return { status: 'resolved', dish: exact[0], candidates: [] }
  }

  // Same name in two categories, e.g. a veg and a non-veg "Biryani".
  if (exact.length > 1) {
    return { status: 'ambiguous', candidates: exact, reason: 'duplicate_name' }
  }

  // No exact match. Offer near misses, but never auto-select one — a
  // single close match is still a guess.
  const contains = dishes.filter((d) => {
    const name = normaliseName(d.name)
    return name.includes(target) || target.includes(name)
  })

  const similar = dishes.filter((d) => isSuspiciouslySimilar(d.name, spokenName))

  const candidates = dedupe([...contains, ...similar])

  if (candidates.length === 0) {
    return { status: 'not_found', candidates: [] }
  }

  return { status: 'ambiguous', candidates, reason: 'no_exact_match' }
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((d) => (seen.has(d.id) ? false : seen.add(d.id)))
}

module.exports = { resolveDish }
