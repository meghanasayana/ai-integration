'use strict'

const { labelsFromName } = require('./portion')

const { editDistance } = require('./dishName')

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

/** Table column headings that are not section names. */
const COLUMN_HEADERS = new Set([
  'dish', 'dishes', 'item', 'items', 'name', 'menu', 'particulars',
  'description', 'price', 'prices', 'rate', 'rates', 'amount', 'qty', 'sl', 'sno',
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

/**
 * Is this a portion label, allowing for OCR getting one letter wrong?
 *
 * OCR reads a photographed menu letter by letter and regularly confuses l / I /
 * 1 and O / 0, so "Full" comes back as "Ful" or "FuII". Demanding an exact
 * match left the label row unrecognised, and every biryani lost its Half and
 * Full prices - they became two unlabelled numbers needing review instead.
 *
 * One wrong letter is allowed on words of four letters or more. Shorter words
 * must match exactly: at three letters almost anything is one edit from
 * something, and a dish called "Egg" must not become a portion label.
 */
/**
 * Fold the letter shapes OCR cannot tell apart into one character each.
 *
 * Reading a photograph, "Full" comes back as "Ful", "FuII" or "FuIl" because
 * l, I and 1 are the same handful of pixels. Comparing after folding those
 * together catches the whole family at once, rather than guessing at an edit
 * distance wide enough to cover it - which would also start matching real
 * words to each other.
 */
function ocrCanon(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/[il1|]/g, 'l')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
}

const PORTION_CANON = new Map()
for (const word of PORTION_WORDS) {
  const key = ocrCanon(word)
  if (!PORTION_CANON.has(key)) PORTION_CANON.set(key, word)
}

/**
 * The correctly spelled label for a word OCR may have mangled.
 *
 * Storing "Ful" and "Haif" on a dish would put the misreading in front of a
 * customer, so a label that matched only approximately is written back in its
 * proper form. A word that matched exactly keeps its printed spelling.
 */
function canonicalPortion(word) {
  const clean = String(word).toLowerCase().replace(/[^a-z]/g, '')
  const title = (w) => w.charAt(0).toUpperCase() + w.slice(1)

  if (PORTION_WORDS.has(clean)) return title(clean)

  const canon = ocrCanon(word)
  const exact = PORTION_CANON.get(canon)
  if (exact) return title(exact)

  for (const [key, original] of PORTION_CANON.entries()) {
    if (key.length < 4) continue
    if (Math.abs(key.length - canon.length) > 1) continue
    if (editDistance(key, canon) <= 1) return title(original)
  }

  return String(word).trim()
}

function isPortionWord(cell) {
  const clean = String(cell).toLowerCase().replace(/[^a-z]/g, '')
  if (clean === '') return false

  // A table heading is never a portion label, and tolerating OCR errors made
  // this urgent: "Dish" is one letter from "Fish", which IS a label on menus
  // that price by meat. Counting the heading as a label gave three labels for
  // two price columns, so every biryani lost its Half and Full prices.
  if (COLUMN_HEADERS.has(clean)) return false

  if (PORTION_WORDS.has(clean)) return true

  const canon = ocrCanon(cell)
  if (canon === '') return false
  if (PORTION_CANON.has(canon)) return true

  // A single missing or extra letter, on words long enough for that to be
  // meaningful. Below four letters almost anything is one edit from something,
  // and a dish called "Egg" must not be read as a column label.
  if (canon.length < 3) return false

  for (const key of PORTION_CANON.keys()) {
    if (key.length < 4) continue
    if (Math.abs(key.length - canon.length) > 1) continue
    if (editDistance(key, canon) <= 1) return true
  }

  return false
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
      const quantity = isPortionWord(word) ? canonicalPortion(word) : word
      labels.push(quantity + ' ' + next)
      i += 2
      continue
    }

    // "250ml" with no space keeps its printed form; a size word is written
    // back correctly spelled in case OCR mangled it.
    if (isPortionWord(word)) {
      labels.push(canonicalPortion(word))
      i += 1
      continue
    }
    if (/\d/.test(word) && isUnitWord(word)) {
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

/** Single letters a menu uses as a shorthand beside a dish. */
const QUALIFIER_WORDS = { d: 'Dry', g: 'Gravy' }

/** "(D)" -> "(Dry)". Anything longer is already a word and is left alone. */
function expandQualifier(cell) {
  const inner = String(cell).replace(/^\(|\)$/g, '').trim()
  const word = QUALIFIER_WORDS[inner.toLowerCase()]
  return word ? `(${word})` : cell
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
  let match = text.match(new RegExp('^(.*?[A-Za-z0-9)])\\s+(' + valueRun + ')$', 'i'))

  // Prices separated by slashes, as "(F/H/Q) 510/300/200". The run above
  // expects whitespace between them.
  if (!match) {
    match = text.match(/^(.*?[A-Za-z0-9)])\s+(\d{2,5}(?:\s*\/\s*\d{2,5})+)$/)
  }

  // No space at all: the PDF printed "Rice / Noodles240" with the price hard
  // against the name. Only a letter or a closing bracket may precede it, so
  // "Fish-65" and "Chicken 65" - names that genuinely end in a number - are
  // left alone.
  if (!match) {
    match = text.match(/^(.*?[A-Za-z)])(\d{2,4})$/)
  }

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
  let orphanPrices = 0

  const addItem = (item) => {
    const name = currentCategory || 'Uncategorised'
    let category = byName.get(name)
    if (!category) {
      category = { name, items: [] }
      byName.set(name, category)
      categories.push(category)
    }
    category.items.push(item)
    headingJoined = false
  }

  // A heading that is obviously unfinished: it ends mid-phrase, or opens a
  // bracket it never closes. "Rice ( Non - Veg /" is not a section, it is the
  // first line of one.
  const looksUnfinished = (text) => {
    const t = String(text).trim()
    if (/[/&\-,+]$/.test(t)) return true
    const opens = (t.match(/\(/g) || []).length
    const closes = (t.match(/\)/g) || []).length
    return opens > closes
  }

  // ...and the second line of one, which closes a bracket it never opened or
  // starts with the joining character the first line ended on.
  const looksLikeContinuation = (text) => {
    const t = String(text).trim()
    if (/^[/&\-,+]/.test(t)) return true
    const opens = (t.match(/\(/g) || []).length
    const closes = (t.match(/\)/g) || []).length
    return closes > opens
  }

  // A heading printed on two lines is ordinary; one printed on eight is not.
  // Without this, a run of dish names that lost their prices chained into a
  // single category called "Fruit Milk Shake Apple Milk Shake Milk Shake ...".
  let headingJoined = false
  const MAX_HEADING_CHARS = 60

  const setCategory = (name) => {
    const text = String(name).trim()

    // A heading printed on two lines arrives as two rows. Only the last one
    // used to survive, so "Rice ( Non - Veg /" then "Noodles)" filed 21 dishes
    // under a category called "Noodles)". They are joined when the first line
    // is unfinished, when the second is a continuation, or when the first
    // collected no dishes at all - a real section always has some.
    const previous = currentCategory
    if (previous) {
      const started = byName.get(previous)
      const empty = !started || started.items.length === 0
      // Zero dishes is the signal on its own. "Indian Masala" then
      // "(Non-Veg)" carries no punctuation clue at all, and neither does
      // "Special Non-Veg" then "Starters" - but a section that collected
      // nothing before the next heading arrived was never a section.
      const joinable = !headingJoined && `${previous} ${text}`.length <= MAX_HEADING_CHARS
      if (joinable && (empty || looksUnfinished(previous) || looksLikeContinuation(text))) {
        const joined = `${previous} ${text}`.replace(/\s*\/\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim()
        // Rename in place so dishes already filed under the partial name follow.
        const existing = byName.get(previous)
        if (existing) {
          byName.delete(previous)
          existing.name = joined
          byName.set(joined, existing)
        }
        currentCategory = joined
        headingJoined = true
        portionLabels = []
        return
      }
    }

    currentCategory = text
    headingJoined = false
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
      // "Dish  Quarter  Half  Full" leads with a column header, not a section
      // name. Treating it as one filed the grills under a category called
      // "Dish" and lost the real heading.
      if (
        looksLikeName(cells[0]) &&
        !isPortionWord(cells[0]) &&
        !COLUMN_HEADERS.has(plainWord(cells[0]))
      ) {
        setCategory(cells[0])
      }
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

    // A row holding nothing but a number is a price that lost its dish -
    // usually because two names were printed with no gap and merged into one
    // cell. It is not a dish and never can be, so it is counted and dropped
    // rather than sent to review as something an admin could fix.
    if (cells.length === 1 && /^[0-9,]{1,6}$/.test(cells[0])) {
      orphanPrices += 1
      continue
    }

    if (working.length === 0 || !looksLikeName(working[0])) {
      if (cells.some(hasDigit)) unparsed.push(row)
      continue
    }

    // A banner such as "ANBUDE   CAFE" arrives as several cells because the
    // letters are widely spaced, with no price anywhere. Reporting it as a dish
    // whose price could not be read put the restaurant's own name in the review
    // list. Capitals and no digits at all means a heading, not a dish.
    if (!cells.some(hasDigit) && cells.every((c) => c === c.toUpperCase())) {
      setCategory(cells.join(' '))
      continue
    }

    // The name, plus any prices that merged into the name cell.
    // Values are kept in the order printed, including the not-sold dashes, so a
    // gap in the middle does not shift the remaining prices onto the wrong
    // labels - which would quietly sell a Full portion at the Half price.
    const values = []
    const qualifiers = []
    let unreadableCell = false

    for (const cell of working.slice(1)) {
      if (NOT_SOLD.test(cell)) { values.push({ unsold: true }); continue }

      // A short bracketed note between the name and the price belongs to the
      // name: "Tandoori Chilly Chicken  (D)  250" is a dry one, not a row
      // nobody can read. Only brackets, and only short ones, so a stray cell
      // of real text still sends the row to review.
      if (/^\([^()]{1,12}\)$/.test(cell)) { qualifiers.push(expandQualifier(cell)); continue }

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

    // Only mine the name cell for prices when no other cell carried one.
    //
    // "Chicken 65" beside a separate "190" is a dish whose NAME ends in a
    // number; stripping it imported "Chicken" priced 65 and threw the real
    // price away. A lone cell like "Pepper Barbeque Chicken 450 250 160" has
    // genuinely swallowed its prices and still needs splitting.
    let name = working[0]
    if (qualifiers.length > 0) name = `${name} ${qualifiers.join(' ')}`.trim()
    if (values.length === 0 && !unreadableCell) {
      const split = splitNameAndPrices(working[0])
      name = split.name
      for (const token of split.tokens) values.push(token)
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

    // Sizes printed inside the name: "Piri Piri Tandoori Chi. (F/H/Q)" beside
    // 510/300/200 is one dish in three sizes, not three prices nobody can
    // explain. The label has to be there in the name - this never guesses.
    const inName = labelsFromName(name)
    if (inName && inName.labels.length === priced.length) {
      addItem(
        priced.length === 1
          ? { name: inName.base, price: priced[0].price }
          : {
              name: inName.base,
              portions: inName.labels.map((label, i) => ({ label, price: priced[i].price })),
            },
      )
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
    stats: { dishes, categories: categories.length, ambiguous, orphanPrices, unparsed: unparsed.length },
  }
}

module.exports = {
  parseRows,
  splitNameAndPrices,
  isPortionWord,
  canonicalPortion,
  isUnitWord,
  expandPortionCell,
  portionLabelsOf,
  isDecorativeEcho,
  priceOf,
  pricesIn,
}
