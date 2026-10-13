'use strict'

/**
 * Price parsing for menu import.
 *
 * Menus write prices in many ways: "190", "₹190", "Rs. 190", "190/-",
 * "1,250", "190.00". The AI passes these through roughly as printed, so
 * normalising them is our job, not the model's.
 *
 * Nothing here guesses. If a value cannot be read confidently it is
 * rejected and the caller flags the row for human review.
 */

const MAX_REASONABLE_PRICE = 100000

// Currency markers and decorations stripped before parsing.
const DECORATIONS = [
  /₹/g,
  /\brs\.?/gi,
  /\binr\b/gi,
  /\$/g,
  /€/g,
  /£/g,
  /\/-\s*$/,      // trailing "/-" as in "190/-"
  /\bonly\b/gi,
]

/**
 * @param {string|number} raw
 * @returns {{ok: true, value: number, warnings: string[]} | {ok: false, reason: string}}
 */
function parsePrice(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'missing' }
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: 'not_a_number' }
    return finalise(raw)
  }

  if (typeof raw !== 'string') {
    return { ok: false, reason: 'not_a_number' }
  }

  let cleaned = raw.trim()
  if (cleaned === '') return { ok: false, reason: 'missing' }

  for (const pattern of DECORATIONS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Thousands separators, but only between digits: "1,250" -> "1250".
  cleaned = cleaned.replace(/(?<=\d),(?=\d{3}\b)/g, '')
  cleaned = cleaned.replace(/\s+/g, '')

  // A slash at this point means two prices were merged, e.g. "110/140".
  // That is ambiguous, not parseable. The caller must split it first.
  if (cleaned.includes('/')) {
    return { ok: false, reason: 'multiple_values' }
  }

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, reason: 'unparseable' }
  }

  return finalise(Number(cleaned))
}

function finalise(value) {
  if (value < 0) return { ok: false, reason: 'negative' }

  // Round to paise. Avoids 190.00000000000003 reaching a Decimal column.
  const rounded = Math.round(value * 100) / 100

  const warnings = []
  if (rounded === 0) warnings.push('price_is_zero')
  if (rounded > MAX_REASONABLE_PRICE) warnings.push('price_unusually_high')

  return { ok: true, value: rounded, warnings }
}

/**
 * Splits a combined price cell such as "110 / 140" or "140-200-420".
 * Returns the raw parts without interpreting what they mean — deciding
 * that they are quarter/half/full would be a guess.
 *
 * @returns {string[]} one entry per price found
 */
function splitCombinedPrices(raw) {
  if (typeof raw !== 'string') return []
  return raw
    .split(/[/|]|(?<=\d)\s*[-–—]\s*(?=\d)/)
    .map((part) => part.trim())
    .filter(Boolean)
}

module.exports = { parsePrice, splitCombinedPrices, MAX_REASONABLE_PRICE }
