'use strict'

/**
 * Portion label handling.
 *
 * Menus name the same portion many ways: "Quarter", "1/4", "¼", "Qtr".
 * We map the ones we recognise onto a canonical label so that re-uploading
 * a menu does not create "Quarter" and "1/4" as two different portions.
 *
 * A label we do not recognise is NOT an error. "Jumbo" or "Family Pack" are
 * perfectly valid portions. We keep them as written and mark them
 * unrecognised so the admin can see what was read.
 */

const CANONICAL = {
  quarter: ['quarter', 'qtr', 'qrt', '1/4', '¼', 'quarter plate', '1/4 plate'],
  half: ['half', '1/2', '½', 'half plate', '1/2 plate', 'hlf'],
  full: ['full', 'full plate', '1/1', 'whole'],
  small: ['small', 's', 'sml', 'sm'],
  medium: ['medium', 'm', 'med', 'mid'],
  large: ['large', 'l', 'lrg', 'lg', 'big'],
  // Regular and Special are a pair in their own right, not sizes. A menu
  // printing \"Regular  Special\" over two price columns is naming two
  // versions of the dish - a plain one and a loaded one - and the admin
  // import screen has always offered them as the default pair for two
  // unlabelled prices. Regular used to be read as Full, which left Special
  // unrecognised and sent every dish in such a section to review.
  regular: ['regular', 'reg', 'normal', 'plain'],
  special: ['special', 'spl', 'spcl'],
}

// Built once: every alias -> canonical name.
const ALIAS_TO_CANONICAL = new Map()
for (const [canonical, aliases] of Object.entries(CANONICAL)) {
  ALIAS_TO_CANONICAL.set(canonical, canonical)
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(alias, canonical)
}

const PIECE_PATTERN = /^(\d+)\s*(?:pcs?|pieces?|pc)$/i

// Menus abbreviate the sizes into the dish name: "Tandoori Chicken (F/H/Q)".
// Only letters that mean a portion are accepted, so a dish written "(B/L)"
// for bone and boneless is left alone rather than invented into sizes.
const LETTER_TO_CANONICAL = {
  f: 'full', h: 'half', q: 'quarter',
  s: 'small', m: 'medium', l: 'large',
}

const NAME_LABELS_RE = /\s*\(\s*([A-Za-z]{1,6}(?:\s*\/\s*[A-Za-z]{1,6}){0,3})\s*\)\s*$/

/**
 * @param {string} raw label as printed on the menu
 * @returns {{ok: false, reason: string} | {ok: true, canonical: string, label: string, recognised: boolean}}
 */
function normalisePortion(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'missing' }

  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return { ok: false, reason: 'missing' }

  const key = trimmed.toLowerCase().replace(/[.]/g, '')

  const known = ALIAS_TO_CANONICAL.get(key)
  if (known) {
    return { ok: true, canonical: known, label: titleCase(known), recognised: true }
  }

  // "4 pcs", "8 pieces" -> a canonical, comparable piece count.
  const pieces = key.match(PIECE_PATTERN)
  if (pieces) {
    const count = Number(pieces[1])
    if (count > 0) {
      return {
        ok: true,
        canonical: `${count}_pieces`,
        label: `${count} Pieces`,
        recognised: true,
      }
    }
  }

  // Unrecognised but explicitly written. Keep it, flag it.
  return {
    ok: true,
    canonical: key.replace(/\s+/g, '_'),
    label: titleCase(trimmed),
    recognised: false,
  }
}

/**
 * Portion labels printed inside the dish name, as "(F/H/Q)" or "(Full/Half)".
 *
 * Returns the name without them and the labels in printed order, or null when
 * the brackets hold something else. Every part has to be a portion for the
 * whole thing to count: half a match is a guess, and a guess here sells a
 * full plate at the quarter price.
 *
 * @returns {{base: string, labels: string[]} | null}
 */
function labelsFromName(name) {
  const text = String(name ?? '')
  const match = text.match(NAME_LABELS_RE)
  if (!match) return null

  const parts = match[1].split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const labels = []
  for (const part of parts) {
    const key = part.toLowerCase().replace(/[.]/g, '')
    const canonical = key.length === 1
      ? LETTER_TO_CANONICAL[key]
      : ALIAS_TO_CANONICAL.get(key)

    if (!canonical) return null
    labels.push(titleCase(canonical))
  }

  // The same size twice is a misread, not a menu.
  if (new Set(labels).size !== labels.length) return null

  const base = text.slice(0, match.index).trim()
  if (!base) return null

  return { base, labels }
}

function titleCase(value) {
  return value
    .split(/[\s_]+/)
    .map((word) => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

/**
 * True when a set of portion labels contains the same portion twice,
 * e.g. ["Half", "1/2"] — which would violate the FoodItemPortion
 * @@unique([foodItemId, portion]) constraint if imported as-is.
 */
function findDuplicatePortions(canonicalLabels) {
  const seen = new Set()
  const duplicates = new Set()
  for (const label of canonicalLabels) {
    if (seen.has(label)) duplicates.add(label)
    seen.add(label)
  }
  return [...duplicates]
}

module.exports = { normalisePortion, findDuplicatePortions, labelsFromName, CANONICAL }
