'use strict'

/**
 * Dish name handling.
 *
 * Two jobs, deliberately kept apart:
 *
 *   normaliseName  - a stable key for deciding "this is the same dish".
 *                    Only safe transformations: case, spacing, punctuation,
 *                    accents. Nothing that could merge two real dishes.
 *
 *   isSuspiciouslySimilar - a warning signal only. "Pepper Grill" and
 *                    "Peri Peri Grill" are different dishes and must never
 *                    be merged automatically; this just surfaces them.
 */

function normaliseName(raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')      // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein distance, iterative, two-row. */
function editDistance(a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution)
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * Close enough to be worth a human glance, not close enough to act on.
 * Returns false for short names, where a one-character difference is
 * usually a genuinely different dish.
 */
function isSuspiciouslySimilar(a, b) {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (!left || !right || left === right) return false
  if (Math.min(left.length, right.length) < 6) return false

  const distance = editDistance(left, right)
  return distance > 0 && distance <= 2
}

module.exports = { normaliseName, isSuspiciouslySimilar, editDistance }
