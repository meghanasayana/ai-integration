'use strict'

/**
 * Rewriting a row into the shape the dish parser understands.
 *
 * parseRows reads a row of cells as one dish: a name, then its prices. Real
 * menus print rows holding more than that, and each of these shapes cost a
 * whole page before this module existed - not one dish, the page:
 *
 *   dotted leaders   "Paneer Tikka .......... 260"     one cell, dots between
 *   three columns    ["Paneer","260","Dal","260",...]  one row, several dishes
 *   inline prices    ["Paneer Tikka 260","Dal 260"]    one cell per dish
 *   centred cards    ["Paneer Tikka"] then ["260"]     price on the next line
 *
 * Every one is turned into plain [name, price] rows before the dish parser
 * sees them, so the parser keeps its single job and these shapes are fixed
 * once rather than in four places.
 *
 * Each rule below refuses unless it is sure, because a wrong guess here
 * invents a dish, and an unread row at least shows up in the review list.
 */

// Three or more of the same mark in a row is a leader, drawn to lead the eye
// from a name to its price. One or two are punctuation: "Chicken - 65",
// "Fish -- served cold". Spaced dots are leaders too: ". . . . . ."
const LEADERS = /(?:[.·•∙]\s?){3,}|[-–—_]{3,}|…+/g

// A cell that is nothing but a price: "260", "₹260", "Rs. 260", "260/-",
// "260/300". Letters other than a currency word disqualify it, so a dish
// called "7 Up" is never read as money.
const PRICE_ONLY = /^(?:₹|rs\.?|inr)?\s*\d{1,5}(?:[.,]\d{1,2})?(?:\s*\/\s*\d{1,5}(?:[.,]\d{1,2})?)*\s*(?:\/-|-)?$/i

// A name with its price pushed onto the end of the same cell.
const NAME_THEN_PRICE = /^(.*[A-Za-z)])\s+((?:₹|rs\.?)?\s*\d{1,5}(?:\s*\/\s*\d{1,5})*)\s*(?:\/-)?$/i

// A name that itself ends in a number, then the price: "Chicken 65 240".
const NAME_NUMBER_THEN_PRICE = /^(.*[A-Za-z].*?)\s+(\d{1,2})\s+(\d{2,5})$/

// How far apart two prices for one dish can sensibly be. A half and a full
// portion of the same thing sit within about twice each other; nothing is
// sold at under a third of its own price.
const PORTION_RATIO = 2.5

const text = (cell) => String(cell == null ? '' : cell).trim()

// A phone number: ten digits, however they are grouped. "9884 445 767" and
// "9840014360 | 9884880570" are both contact details, not prices.
const PHONE = /(?:\d[\s-]?){10,}/

// A six digit postcode at the end of a line, as an address ends.
const POSTCODE = /\b\d{6}\b\s*$/

// The notices every menu prints somewhere. Structure catches most footers on
// its own; these catch the short ones that structure cannot.
const NOTICE = /\b(?:gst|vat|service charge|taxes? (?:extra|applicable)|timings?|open(?:ing)? hours|terms|conditions|reservations?|wi-?fi|follow us|all rights reserved)\b/i

// Dish names are short. Across both real menus the longest is six words
// ("Chinese Fry with Worcester Sauce" is five). Eight or more words with no
// price is a sentence, and a menu's sentences are notices.
const PROSE_WORDS = 8

// A line printed on every page is the restaurant's name, not a section of the
// menu. Three occurrences, not two: a long section genuinely does repeat its
// heading when it carries on overleaf, and dropping that would merge its
// dishes into whatever came before.
const RUNNING_HEAD_PAGES = 3

/**
 * Lines repeated so often they can only be a running head or foot.
 *
 * "ANBU MESS" sits at the top of all four pages. Read as a heading it became
 * a category, and because it collected the dishes printed above the first real
 * heading, ten tiffin dishes were filed under the restaurant's name.
 */
function runningHeads (rows) {
  const counts = new Map()

  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 1) continue
    const value = text(row[0])
    if (value === '' || isPriceOnly(value) || /\d/.test(value)) continue
    const key = value.toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const heads = new Set()
  for (const [key, count] of counts) if (count >= RUNNING_HEAD_PAGES) heads.add(key)
  return heads
}

/**
 * Is this row the small print rather than a dish?
 *
 * The footer cost more than the seven lines it occupies: "For Reservations
 * Please Contact 9884 445 767" was read as a dish named after the sentence,
 * priced 9884, and it reached the review list for someone to puzzle over.
 *
 * Only rows carrying no price are considered, so a real dish is never at
 * risk: whatever else it is, a dish has a price next to it.
 */
function isPageFurniture (cells) {
  if (cells.length === 0) return false

  const joined = cells.map(text).join(' ')
  if (joined === '') return false

  // A dish with a price of its own is a dish. Nothing below applies.
  if (cells.some((c) => isPriceOnly(c))) return false
  if (cells.length > 1 && cells.slice(1).some((c) => /\d/.test(text(c)) && !isNameOnly(c))) return false

  if (PHONE.test(joined)) return true
  if (POSTCODE.test(joined)) return true
  if (NOTICE.test(joined)) return true

  // A line left hanging on a comma is a sentence or an address continued on
  // the next line. No dish name and no section heading ends that way.
  if (/,$/.test(joined)) return true

  // A strapline under the restaurant's name: "coffee house . kitchen . open
  // from seven", "biriyani, kari and kuzhambu". Set entirely in lower case,
  // which a section heading on these menus never is, and several words long.
  // Left in, it was glued onto the heading below it and named the category
  // after the strapline.
  if (joined === joined.toLowerCase() && joined.split(/\s+/).filter(Boolean).length >= 3) return true

  const words = joined.split(/\s+/).filter(Boolean)
  if (words.length >= PROSE_WORDS) return true

  return false
}

/** Is this cell money and nothing else? */
function isPriceOnly (cell) {
  const value = text(cell)
  if (value === '') return false
  return PRICE_ONLY.test(value)
}

/** Does this cell read as a dish name - some letters, no price of its own? */
function isNameOnly (cell) {
  const value = text(cell)
  if (value === '') return false
  if (isPriceOnly(value)) return false
  return /[A-Za-z]{2}/.test(value)
}

/**
 * Take the leader dots out of a cell.
 *
 * "Paneer Tikka ....... 260" becomes "Paneer Tikka 260", which the dish
 * parser already reads. Without this the whole cell was one unreadable name
 * and a twenty-four dish menu imported nothing at all.
 */
function stripLeaders (cell) {
  const value = text(cell)
  if (!LEADERS.test(value)) return value
  return value.replace(LEADERS, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Read "Chicken 65 240" as a dish called "Chicken 65" costing 240.
 *
 * Numbers in dish names are everywhere on an Indian menu - Chicken 65, Fish
 * 65, Gobi 65 - and a name ending in one leaves two numbers in a row where
 * the parser expects a name and a price. Read as two prices, the dish became
 * "Chicken" needing review, and its real name was lost.
 *
 * What separates the two cases is the gap between the numbers. Two prices for
 * one dish are a half and a full portion, within about twice each other;
 * "Paneer Mandi 1100 570" is such a pair and stays one. 240 is nearly four
 * times 65, which no portion of the same dish ever is, so 65 is part of the
 * name. Refusing on anything closer leaves a genuine pair for the review
 * step, where a person decides - better than this guessing.
 *
 * Returns null unless the gap is wide enough to be sure.
 */
function splitNameEndingInNumber (cell) {
  const match = text(cell).match(NAME_NUMBER_THEN_PRICE)
  if (!match) return null

  const inName = Number(match[2])
  const price = Number(match[3])
  if (!(inName > 0) || !(price > 0)) return null
  if (price < inName * PORTION_RATIO) return null

  return [`${match[1].trim()} ${match[2]}`, match[3]]
}

/**
 * Split a row that carries several dishes side by side.
 *
 * A three column menu reconstructs as one row per line across the whole page:
 * ["Paneer Tikka","260","Chicken 65","240","Butter Chicken","380"]. Walking
 * the row in name-then-price pairs recovers all three.
 *
 * Returns null unless the row divides cleanly into two or more such pairs.
 * A row that leaves anything over is handed back untouched, because a
 * leftover cell means the shape was something else.
 */
function splitSideBySide (cells) {
  if (cells.length < 4 || cells.length % 2 !== 0) return null

  const pairs = []
  for (let i = 0; i < cells.length; i += 2) {
    if (!isNameOnly(cells[i])) return null
    if (!isPriceOnly(cells[i + 1])) return null
    pairs.push([text(cells[i]), text(cells[i + 1])])
  }

  return pairs.length >= 2 ? pairs : null
}

/**
 * Split a row whose every cell is a dish complete with its price.
 *
 * Menus that set the price straight after the name, with no column to line it
 * up in, reconstruct as ["Paneer Tikka 260","Butter Chicken 380"] - two
 * dishes the parser read as one unreadable row.
 *
 * Every cell has to carry a price. One that does not means the row is a name
 * in one column and something else in another, which is not this shape.
 */
function splitInline (cells) {
  if (cells.length < 2) return null

  const rows = []
  for (const cell of cells) {
    const named = splitNameEndingInNumber(cell)
    if (named) {
      rows.push(named)
      continue
    }
    const match = text(cell).match(NAME_THEN_PRICE)
    if (!match) return null
    rows.push([match[1].trim(), match[2].replace(/\s+/g, '')])
  }

  return rows
}

// A centred menu has to show the pattern several times before it is believed.
// Two lone names each followed by a lone price could be a heading and a stray
// number; six in a row is a layout.
const MIN_STACKED = 3

/**
 * Join a price printed on the line below its name.
 *
 * Centred menus set the name on one line and the price on the next, which
 * reconstructs as ["Paneer Tikka"] then ["260"]. The dish parser reads a lone
 * word with no digits as a section heading, so such a menu became twelve
 * categories holding no dishes and twelve prices belonging to nobody.
 *
 * A section heading is safe: nothing is joined unless the very next row is a
 * price on its own, and a heading is followed by a name.
 */
function joinStackedPrices (rows) {
  const candidate = (i) =>
    Array.isArray(rows[i]) && rows[i].length === 1 && isNameOnly(rows[i][0]) &&
    Array.isArray(rows[i + 1]) && rows[i + 1].length === 1 && isPriceOnly(rows[i + 1][0])

  let found = 0
  for (let i = 0; i < rows.length - 1; i += 1) if (candidate(i)) found += 1
  if (found < MIN_STACKED) return rows

  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    if (candidate(i)) {
      out.push([text(rows[i][0]), text(rows[i + 1][0])])
      i += 1
      continue
    }
    out.push(rows[i])
  }

  return out
}

/**
 * Put every row into the shape the dish parser reads, in one pass.
 *
 * @param {string[][]} rows
 * @returns {string[][]}
 */
function normaliseRows (rows) {
  if (!Array.isArray(rows)) return []

  const heads = runningHeads(rows)
  const expanded = []

  for (const row of rows) {
    if (!Array.isArray(row)) {
      expanded.push(row)
      continue
    }

    const cells = row.map(stripLeaders).filter((c) => c !== '')
    if (cells.length === 0) continue

    // Addresses, phone numbers, GST notes and opening hours are dropped here
    // rather than handed on. Left in, the dish parser made a dish of them.
    if (cells.length === 1 && heads.has(text(cells[0]).toLowerCase())) continue
    if (isPageFurniture(cells)) continue

    // A single cell whose name ends in a number is split here so the dish
    // parser sees a name and a price. Other single cells are left exactly as
    // they are, because the parser already reads them.
    if (cells.length === 1) {
      const named = splitNameEndingInNumber(cells[0])
      if (named) {
        expanded.push(named)
        continue
      }
    }

    const sideBySide = splitSideBySide(cells)
    if (sideBySide) {
      for (const pair of sideBySide) expanded.push(pair)
      continue
    }

    const inline = splitInline(cells)
    if (inline) {
      for (const one of inline) expanded.push(one)
      continue
    }

    expanded.push(cells)
  }

  return joinStackedPrices(expanded)
}

module.exports = {
  normaliseRows,
  stripLeaders,
  splitSideBySide,
  splitInline,
  splitNameEndingInNumber,
  joinStackedPrices,
  isPageFurniture,
  isPriceOnly,
  isNameOnly,
}
