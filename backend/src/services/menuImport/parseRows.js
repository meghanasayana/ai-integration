'use strict'

/**
 * Reading reconstructed rows directly, with no model.
 *
 * Why this exists
 * ---------------
 * The hard problem in importing a menu is working out which price belongs to
 * which dish. On a column-drawn PDF that information is lost in the text, and
 * pdfLayout.js recovers it from the position of every word. Once a row reads
 *
 *     Chicken Masala <TAB> 220
 *
 * there is no judgement left to make, and asking a model to retype it is pure
 * cost: measured on this machine, output generation runs at about 4.7 tokens a
 * second, so a page of JSON takes well over a minute, and a 12-page menu takes
 * half an hour. This module reads the same rows in milliseconds.
 *
 * It is NOT AI, and must never be described as such. It is a parser with a
 * deliberately narrow idea of what it understands, and it refuses rather than
 * guesses: a row it cannot read confidently is returned in `unparsed`, for the
 * model to interpret or for a person to fix. Guessing would reintroduce exactly
 * the invented prices the whole pipeline exists to prevent.
 */

/** Words that label a price column rather than name a dish. */
const PORTION_WORDS = new Set([
  'quarter', 'qtr', 'half', 'full', 'small', 'medium', 'large', 'regular',
  'mini', 'jumbo', 'single', 'double', 'dry', 'gravy', 'chicken', 'mutton',
  'veg', 'paneer', 'egg', 'prawn', 'fish', 'plate', 'pc', 'pcs', 'piece', 'pieces',
])

/**
 * Units a drinks or dessert menu sells by, as in "Half Kg", "250ml",
 * "Single Scoop". These pair with a quantity in front of them, so they are
 * kept apart from the plain words above: "Kg" alone labels nothing.
 */
const UNIT_WORDS = new Set([
  'kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams',
  'ml', 'l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters',
  'scoop', 'scoops', 'glass', 'glasses', 'bottle', 'bottles',
  'cup', 'cups', 'mug', 'slice', 'slices', 'box', 'pack',
])

function plainWord(text) {
  return String(text).toLowerCase().replace(/[^a-z]/g, '')
}

function isUnitWord(cell) {
  return UNIT_WORDS.has(plainWord(cell))
}

/** Something that can sit in front of a unit: a number, or a size word. */
function isQuantityWord(cell) {
  const text = String(cell).trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return true
  return PORTION_WORDS.has(plainWord(text))
}

/**
 * One number, as menus print them: 190, 1,250, 99.50. The thousands separator
 * needs three digits after it - treating "1,250" as "1" and "250" turned one
 * price into two and sent the dish to review for no reason.
 */
const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d{1,6})(?:\\.\\d{1,2})?'

/** A currency mark before the number, and the "/-" some menus put after it. */
const CURRENCY = '(?:rs\\.?|₹)?\\s*'
const TRAILING = '\\s*(?:/-)?'

/** A cell that is a price: a number, with or without the decoration above. */
const PRICE_CELL = new RegExp('^' + CURRENCY + '(' + NUMBER + ')' + TRAILING + '$', 'i')

/**
 * Several prices in one cell, as happens when columns sit close together, or
 * when a menu prints "110 / 140" for two variants on one line.
 */
const MERGED_PRICES = new RegExp(
  '^(?:' + CURRENCY + NUMBER + TRAILING + '\\s*[/|]?\\s*)+$', 'i')

/** A dash in a price column: that portion is not sold. */
const NOT_SOLD = /^[-–—]$/

function priceOf(cell) {
  const match = String(cell).trim().match(PRICE_CELL)
  if (!match) return null
  return match[1].replace(/,/g, '')
}

/** Every price in a cell holding more than one. */
function pricesIn(cell) {
  const text = String(cell).trim()
  if (!MERGED_PRICES.test(text)) return null
  const found = text.match(new RegExp(NUMBER, 'g'))
  return found ? found.map((n) => n.replace(/,/g, '')) : null
}

function isPortionWord(cell) {
  const clean = String(cell).toLowerCase().replace(/[^a-z]/g, '')
  return PORTION_WORDS.has(clean)
}

/**
 * Portion labels held in a single cell, or null if the cell is not labels.
 *
 * Labels do not always arrive one per cell. Pasted text separated by single
 * spaces gives "Quarter Half Full" as one cell, and a real menu whose columns
 * sit close together gives "Half Quarter" stuck together. Treating either as a
 * single unrecognised label left three prices with no labels, which the review
 * step then had to ask about - when the menu had in fact printed them clearly.
 */
function expandPortionCell(cell) {
  const words = String(cell).trim().split(/[\s/|]+/).filter((w) => w !== '')
  if (words.length === 0) return null

  const labels = []
  let i = 0

  while (i < words.length) {
    const word = words[i]
    const next = words[i + 1]

    // "Half Kg", "1 Kg", "Single Scoop": a quantity and the unit it measures
    // are one label, not two. Splitting them produced four labels for two
    // price columns, so the row was reported as unlabelled and every cake and
    // bottled drink went to review needlessly.
    if (isQuantityWord(word) && next && isUnitWord(next)) {
      labels.push(word + ' ' + next)
      i += 2
      continue
    }

    // "250ml" with no space, and the plain size words.
    if (isPortionWord(word) || (/\d/.test(word) && isUnitWord(word))) {
      labels.push(word)
      i += 1
      continue
    }

    return null
  }

  return labels.length > 0 ? labels : null
}

/** The labels a whole row carries, or null if it is not a label row. */
function portionLabelsOf(cells) {
  const labels = []
  for (const cell of cells) {
    if (NOT_SOLD.test(cell)) continue
    const expanded = expandPortionCell(cell)
    if (!expanded) return null
    for (const word of expanded) labels.push(word)
  }
  return labels.length > 0 ? labels : null
}

function hasDigit(cell) {
  return /\d/.test(String(cell))
}

function looksLikeName(cell) {
  // Two letters, not three: "7 Up 60" has only "Up", and requiring three
  // letters made the whole row unreadable and then dropped it without a word.
  return /[A-Za-z]{2}/.test(String(cell))
}

/**
 * Is this the sideways decorative text rather than a heading?
 *
 * Such text is set in capitals and repeats a word of the section it sits
 * beside, e.g. "BIRYANI" printed down the edge of the Clay Pot Biryani list.
 */
function isDecorativeEcho(cell, currentCategory) {
  if (!currentCategory) return false
  const text = String(cell).trim()
  if (text !== text.toUpperCase()) return false

  const words = currentCategory.toUpperCase().split(/\s+/)
  return words.includes(text.toUpperCase())
}

/**
 * Split a name cell that swallowed its prices.
 * "Pepper Barbeque Chicken 450 250 160" -> name + three prices.
 */
function splitNameAndPrices(cell) {
  const text = String(cell).trim()
  // A dash belongs in the run too: "Paneer Mandi 1100 570 -" prices two
  // portions and marks the third as not sold. Stopping at the dash lost the
  // whole row, and dropping a dish is worse than any other failure here.
  const valueRun = '(?:(?:' + CURRENCY + NUMBER + TRAILING + '|[-–—])\\s*){1,6}'
  const match = text.match(new RegExp('^(.*?[A-Za-z0-9)])\\s+(' + valueRun + ')$', 'i'))
  if (!match) return { name: text, prices: [], tokens: [] }

  const found = match[2].match(new RegExp(NUMBER + '|[-–—]', 'g')) || []
  const tokens = found.map((token) =>
    /\d/.test(token) ? { price: token.replace(',', '') } : { unsold: true })

  return {
    name: match[1].trim(),
    prices: tokens.filter((t) => t.price).map((t) => t.price),
    tokens,
  }
}

/**
 * Read rows into categories.
 *
 * @param {string[][]} rows
 * @returns {{categories: object[], unparsed: string[][], stats: object}}
 */
function parseRows(rows) {
  const categories = []
  const byName = new Map()
  const unparsed = []

  let currentCategory = null
  let portionLabels = []
  let ambiguous = 0

  const addItem = (item) => {
    const name = currentCategory || 'Uncategorised'
    let category = byName.get(name)
    if (!category) {
      category = { name, items: [] }
      byName.set(name, category)
      categories.push(category)
    }
    category.items.push(item)
  }

  const setCategory = (name) => {
    currentCategory = name
    portionLabels = []
  }

  for (const row of rows || []) {
    if (!Array.isArray(row) || row.length === 0) continue

    const cells = row.map((c) => String(c).trim()).filter((c) => c !== '')
    if (cells.length === 0) continue

    // Labels can arrive as one cell: "Quarter Half Full" pasted with single
    // spaces. Two or more portion words together are labels; a single one is
    // not, because "Veg" and "Full" alone are real section headings in this
    // menu and must not be mistaken for a column label.
    const soloLabels = cells.length === 1 ? expandPortionCell(cells[0]) : null
    if (soloLabels && soloLabels.length >= 2) {
      portionLabels = soloLabels
      continue
    }

    // A lone word with no digits is a section heading - unless it is the
    // decorative text printed sideways down the page, which repeats a word of
    // the current heading in capitals. Treating "BIRYANI" as a new section
    // would file the Clay Pot dishes under a heading the menu never prints.
    if (cells.length === 1 && !hasDigit(cells[0]) && looksLikeName(cells[0])) {
      if (!isDecorativeEcho(cells[0], currentCategory)) setCategory(cells[0])
      continue
    }

    // A row made entirely of portion words is a label row, and every cell is a
    // label. This must be checked before the case below: reading the tail only
    // would drop "Quarter" from "Quarter Half Full" and shift every price one
    // column to the left.
    const wholeRowLabels = portionLabelsOf(cells)
    if (wholeRowLabels) {
      portionLabels = wholeRowLabels
      continue
    }

    // A label row may instead lead with the section name:
    // "Arabian Mandi  Full  Half  Quarter".
    const tail = cells.slice(1)
    const tailLabels = tail.length > 0 ? portionLabelsOf(tail) : null
    if (tailLabels) {
      if (looksLikeName(cells[0]) && !isPortionWord(cells[0])) setCategory(cells[0])
      portionLabels = tailLabels
      continue
    }

    // Decorative section text printed sideways repeats the heading; skip it.
    let working = cells
    if (
      working.length > 1 &&
      currentCategory &&
      !hasDigit(working[0]) &&
      working[0].toUpperCase() === working[0] &&
      currentCategory.toUpperCase().includes(working[0].toUpperCase())
    ) {
      working = working.slice(1)
    }

    if (working.length === 0 || !looksLikeName(working[0])) {
      if (cells.some(hasDigit)) unparsed.push(row)
      continue
    }

    // The name, plus any prices that merged into the name cell.
    const split = splitNameAndPrices(working[0])
    const name = split.name

    // Values are kept in the order printed, including the not-sold dashes, so a
    // gap in the middle does not shift the remaining prices onto the wrong
    // labels - which would quietly sell a Full portion at the Half price.
    const values = split.tokens.slice()
    let unreadableCell = false

    for (const cell of working.slice(1)) {
      if (NOT_SOLD.test(cell)) { values.push({ unsold: true }); continue }

      const single = priceOf(cell)
      if (single !== null) { values.push({ price: single }); continue }

      const many = pricesIn(cell)
      if (many) {
        for (const price of many) values.push({ price })
        continue
      }

      // A cell that is neither a price nor a dash is something this parser does
      // not understand, so the whole row goes to someone who might - a model,
      // or a person. Importing the name without its price would be worse.
      unreadableCell = true
      values.length = 0
      break
    }

    const priced = values.filter((v) => v.price)

    if (!name || priced.length === 0) {
      // A row that offered something in a price column, or that carries digits,
      // was meant to be a dish. A bare tagline was not, and is simply skipped.
      if (unreadableCell || cells.some(hasDigit)) unparsed.push(row)
      continue
    }

    if (values.length === 1) {
      addItem({ name, price: priced[0].price })
      continue
    }

    // Labels line up with every column, dashes included: drop the unsold ones
    // and keep each remaining price against its own label.
    if (portionLabels.length === values.length) {
      const portions = []
      portionLabels.forEach((label, i) => {
        if (values[i] && values[i].price) portions.push({ label, price: values[i].price })
      })
      if (portions.length > 0) {
        addItem(portions.length === 1 ? { name, price: portions[0].price } : { name, portions })
        continue
      }
    }

    // Labels match the prices actually printed, with no dashes to place.
    if (portionLabels.length === priced.length) {
      addItem({
        name,
        portions: portionLabels.map((label, i) => ({ label, price: priced[i].price })),
      })
      continue
    }

    if (priced.length === 1) {
      addItem({ name, price: priced[0].price })
      continue
    }

    // No usable labels. Hand back exactly what was printed, so the review step
    // flags it rather than this parser deciding what "150 / 170" means.
    ambiguous += 1
    addItem({ name, price: priced.map((v) => v.price).join(' / ') })
  }

  const dishes = categories.reduce((n, c) => n + c.items.length, 0)

  return {
    categories,
    unparsed,
    stats: { dishes, categories: categories.length, ambiguous, unparsed: unparsed.length },
  }
}

module.exports = {
  parseRows,
  splitNameAndPrices,
  isPortionWord,
  isUnitWord,
  expandPortionCell,
  portionLabelsOf,
  isDecorativeEcho,
  priceOf,
  pricesIn,
}
