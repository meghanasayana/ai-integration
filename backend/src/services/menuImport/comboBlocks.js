/**
 * Reading combo boxes off a menu page.
 *
 * A combo is a titled box holding a price and a few lines, where a line may
 * offer a choice ("Chicken Biriyani / Mugual Biriyani"). The printed layout
 * is unkind: the price sits in a circle that lands in the middle of the text,
 * "Rs." and the number are often separate, and a long choice wraps across
 * several lines with a trailing slash.
 *
 * Lines are kept exactly as printed. A slash in a menu does not always mean
 * a simple choice — "Veg/Panner/Mushroom/BabyCorn/Gobi Fried Rice/Noodles"
 * is two choices multiplied together, not six options — so guessing is worse
 * than showing the diner what the menu itself says.
 */

const COMBO_WORDS = [
  'combo',
  'meal',
  'thali',
  'platter',
  'set menu',
  'family pack',
  'saver',
]

// "Combo - 1", "Combo -2", "COMBO 3", "Thali", "Family Pack - 2"
const TITLE_RE = new RegExp(
  `^\\s*(${COMBO_WORDS.join('|')})\\b[\\s\\-–—]*([0-9]{1,2})?\\s*$`,
  'i',
)

// A section heading above the boxes, such as "Special Combo Taj".
const SECTION_RE = new RegExp(`\\b(${COMBO_WORDS.join('|')})\\b`, 'i')

// A line that is only a box number, left behind when the title wrapped:
// OCR often reads "Combo - 4" as "Combo" on one line and "4" on the next.
const NUMBER_ONLY_RE = /^[\s\-–—]*([0-9]{1,2})[\s.]*$/
// A line with nothing readable in it: stray quotes, a lone dash, OCR crumbs.
const JUNK_LINE_RE = /^[^A-Za-z0-9]*$/

const PRICE_SLASH_RE = /(\d{2,5})\s*\/\s*-/
const PRICE_RS_RE = /\bRs\.?\s*(\d{2,5})\b/i
const CURRENCY_ONLY_RE = /\bRs\.?\s*$|^\s*Rs\.?\s*|^\s*\/\s*-\s*$/gi

/** Is this line the title of a combo box? */
const isComboTitle = (text) => TITLE_RE.test(String(text ?? '').trim())

/** Does this line mention a combo at all (a page heading, say)? */
const mentionsCombo = (text) => SECTION_RE.test(String(text ?? ''))

/**
 * Pull the price out of a box.
 *
 * Only a number written as "310/-" or "Rs. 310" counts. A bare number is
 * ignored on purpose: "Gobi 65 (5 Pcs)" and "Naan / Rotti (2 Pcs)" are
 * quantities, and reading one of those as the price is the kind of mistake
 * nobody notices until a diner is charged 5 rupees.
 */
const extractPrice = (lines) => {
  const joined = lines.join('\n')

  const slashed = joined.match(PRICE_SLASH_RE)
  if (slashed) return Number(slashed[1])

  const rupees = joined.match(PRICE_RS_RE)
  if (rupees) return Number(rupees[1])

  return null
}

/** Remove the price and stray currency marks from a printed line. */
const stripPrice = (text) => String(text ?? '')
  .replace(PRICE_SLASH_RE, ' ')
  .replace(PRICE_RS_RE, ' ')
  .replace(CURRENCY_ONLY_RE, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim()

/**
 * Join lines that the layout broke mid-choice.
 *
 * "Chicken Biriyani/" / "Mugual Biriyani/" / "Chicken 65 Biriyani" is one
 * line of the combo, split by the width of the box. A trailing slash means
 * the choice continues; so does a leading slash on the next line.
 */
const joinContinuations = (lines) => {
  const out = []

  for (const raw of lines) {
    const text = String(raw ?? '').trim()
    if (!text) continue

    const previous = out[out.length - 1]
    const continuesBefore = previous !== undefined && previous.endsWith('/')
    const continuesAfter = text.startsWith('/')

    if (continuesBefore || continuesAfter) {
      const left = previous.replace(/\/\s*$/, '')
      const right = text.replace(/^\s*\//, '')
      out[out.length - 1] = `${left} / ${right}`.replace(/\s{2,}/g, ' ').trim()
    } else {
      out.push(text)
    }
  }

  return out
}

/**
 * Turn one box into a combo.
 *
 * Returns { name, price, lines, needsReview, reason }. A box with no price
 * or no contents is still returned, flagged, so it shows up in the preview
 * rather than vanishing.
 */
const parseComboBlock = (title, rawLines) => {
  let name = String(title ?? '').trim().replace(/\s*[-–—]\s*/g, ' - ').replace(/\s{2,}/g, ' ')
  const price = extractPrice(rawLines)

  const working = rawLines.slice()

  // A title that lost its number to a line break gets it back, so a
  // photographed "Combo" + "4" is still Combo - 4 and not a nameless box.
  if (!/\d\s*$/.test(name) && working.length > 0) {
    const first = String(working[0] ?? '').trim()
    const match = first.match(NUMBER_ONLY_RE)
    if (match) {
      name = `${name} - ${match[1]}`
      working.shift()
    }
  }

  const lines = joinContinuations(working.map(stripPrice))
    .filter(Boolean)
    .filter((line) => !JUNK_LINE_RE.test(line))

  let needsReview = false
  let reason = null

  if (price === null) {
    needsReview = true
    reason = 'No price found in this box'
  } else if (lines.length === 0) {
    needsReview = true
    reason = 'No items found in this box'
  } else if (lines.length === 1) {
    needsReview = true
    reason = 'Only one item — check this is really a combo'
  }

  return { name, price, lines, needsReview, reason }
}

/**
 * Split a page's lines into combo boxes.
 *
 * Each combo title starts a new box; everything after it belongs to that box
 * until the next title. Anything before the first title (a page heading such
 * as "Special Combo Taj") is dropped.
 */
const splitIntoBoxes = (lines) => {
  const boxes = []

  for (const raw of lines) {
    const text = String(raw ?? '').trim()
    if (!text) continue

    if (isComboTitle(text)) {
      boxes.push({ title: text, lines: [] })
    } else if (boxes.length > 0) {
      boxes[boxes.length - 1].lines.push(text)
    }
  }

  return boxes
}

/** Everything above, end to end, for one page of plain lines. */
const combosFromLines = (lines) =>
  splitIntoBoxes(lines).map((box) => parseComboBlock(box.title, box.lines))

/** Is this page worth running through the combo reader at all? */
const looksLikeComboPage = (lines) => {
  const titles = lines.filter(isComboTitle).length
  if (titles >= 2) return true
  return titles >= 1 && lines.some(mentionsCombo)
}

const hasNumber = (name) => /\d\s*$/.test(String(name ?? '').trim())

/**
 * Drop boxes that are really the page heading.
 *
 * "Special Combo Taj" above the grid reads as a bare "Combo" and would open a
 * box of its own. When the page numbers its combos, a title with no number is
 * the heading, not a combo. A menu that numbers nothing - a page of Thali and
 * Platter - keeps everything.
 */
const dropHeadingBoxes = (combos) => {
  const numbered = combos.filter((combo) => hasNumber(combo.name))
  if (numbered.length >= 2 && numbered.length < combos.length) return numbered
  return combos
}

/** The number in "Combo - 7", or null. */
const comboNumber = (name) => {
  const match = String(name ?? '').trim().match(/(\d{1,2})\s*$/)
  return match ? Number(match[1]) : null
}

/**
 * Finish a page of boxes: drop the heading, then put them in printed order.
 *
 * Ordering happens here rather than when the boxes are cut out, because a
 * title that lost its number to a line break only gets it back during parsing.
 */
const tidyCombos = (combos) => {
  const kept = dropHeadingBoxes(combos)
  const numbers = kept.map((combo) => comboNumber(combo.name))

  if (numbers.every((n) => n !== null) && new Set(numbers).size === numbers.length) {
    return kept
      .map((combo, index) => ({ combo, number: numbers[index] }))
      .sort((a, b) => a.number - b.number)
      .map((entry) => entry.combo)
  }

  return kept
}

module.exports = {
  COMBO_WORDS,
  dropHeadingBoxes,
  tidyCombos,
  comboNumber,
  hasNumber,
  isComboTitle,
  mentionsCombo,
  extractPrice,
  stripPrice,
  joinContinuations,
  parseComboBlock,
  splitIntoBoxes,
  combosFromLines,
  looksLikeComboPage,
}
