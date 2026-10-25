'use strict'

/**
 * Position-based text extraction for PDF menus.
 *
 * Why this exists
 * ---------------
 * Plain text extraction returns text in the order the PDF stores it, which is
 * the order it was drawn. Designed menus are laid out column by column, so a
 * two-column menu is often drawn as "every dish name, then every price":
 *
 *     Arabian Mandi / Mutton Mandi / Chicken Mandi / 160 / 260 / 250
 *
 * Every price is present, but which price belongs to which dish is gone. A
 * model handed that text can only guess, and a guessed price on a real menu is
 * worse than no import at all.
 *
 * Every text item in a PDF carries its own x/y position. Sorting by y puts
 * items back into visual rows regardless of draw order, and sorting each row by
 * x puts the cells back in reading order.
 *
 * Side-by-side sections
 * ---------------------
 * Real menus also place independent sections beside each other, so one visual
 * line crosses two unrelated blocks and grouping purely by y interleaves them:
 *
 *     Kareem Nawab Spl Soup | 150 / 170 | Full | Half Quarter
 *
 * That line is the Soup section on the left and the Grill Chicken section's
 * column headers on the right. So before grouping into rows, the page is split
 * at its vertical whitespace gutters and each block is grouped on its own.
 *
 * The split is validated rather than trusted: a menu's own name/price gap is
 * also a vertical gutter, and splitting there would separate every name from
 * every price and recreate the original bug. A candidate split is therefore
 * rejected unless each substantial block still contains both words and numbers.
 */

/** Share of a line's height within which two items count as the same row. */
const Y_TOLERANCE_RATIO = 0.6

/** Horizontal gap, as a share of line height, that starts a new cell. */
const COLUMN_GAP_RATIO = 0.8

/** Resolution, in points, of the horizontal whitespace scan. */
const SCAN_BUCKET = 2

/** Narrowest vertical whitespace band treated as a possible section divider. */
const MIN_GUTTER_POINTS = 18

/** Blocks at least this tall are held to the words-and-numbers check. */
const SUBSTANTIAL_BLOCK_ROWS = 5

/**
 * Share of a block's rows that must pair a label with a number for the block to
 * be believable as a section of its own.
 *
 * A menu with names on the left and prices on the right has a wide empty
 * middle, which looks exactly like the gutter between two side-by-side
 * sections. Splitting there put every name in one block and every price in
 * another, and the only dishes that survived were those with a number inside
 * the name - "Chicken 65" was imported as "Chicken" priced 65.
 */
const MIN_BLOCK_PAIRING = 0.25

/** Most side-by-side sections to look for on one page. */
const MAX_BLOCKS = 3

/**
 * pdfjs expects a few browser globals at module load time. It normally gets
 * them from the optional native canvas package, which is platform-specific and
 * can fail to load. Text extraction never draws anything, so empty stand-ins
 * are enough to let the module load; they are only installed when genuinely
 * missing, so a working canvas install is left alone.
 */
function ensureBrowserGlobals () {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor (init) {
        const m = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0]
        this.a = m[0]; this.b = m[1]; this.c = m[2]
        this.d = m[3]; this.e = m[4]; this.f = m[5]
      }
    }
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor (width, height) { this.width = width; this.height = height }
    }
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {}
  }
}

/** pdfjs ships as ESM; this project is CommonJS, so import it on demand. */
let pdfjsPromise = null
function loadPdfjs () {
  if (!pdfjsPromise) {
    ensureBrowserGlobals()
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

/**
 * Read a PDF as rows of cells, one array per visual line, with side-by-side
 * sections separated.
 *
 * @param {Buffer} buffer       raw PDF bytes
 * @param {object} [options]
 * @param {number} [options.maxPages]      stop after this many pages
 * @param {boolean} [options.splitColumns] set false to group by y alone
 * @returns {Promise<object>}
 */
async function extractRows (buffer, options = {}) {
  const maxPages = options.maxPages || 20
  const splitColumns = options.splitColumns !== false
  const pdfjs = await loadPdfjs()

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    // The PDF is untrusted input: never let it drive expression evaluation.
    isEvalSupported: false,
  }).promise

  try {
    const pagesRead = Math.min(doc.numPages, maxPages)
    const pages = []

    for (let num = 1; num <= pagesRead; num += 1) {
      const page = await doc.getPage(num)
      let items
      let pageWidth
      try {
        const view = page.view || [0, 0, 595, 842]
        pageWidth = view[2] - view[0]
        const content = await page.getTextContent()
        items = content.items
          .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
          .map((item) => ({
            text: item.str.trim(),
            x: item.transform[4],
            y: item.transform[5],
            // transform[3] is the vertical scale, i.e. the rendered font size.
            height: Math.abs(item.transform[3]) || Math.abs(item.height) || 10,
            width: item.width,
          }))
      } finally {
        page.cleanup()
      }

      const blocks = splitColumns ? splitIntoBlocks(items, pageWidth) : [items]

      const rows = []
      for (const block of blocks) {
        for (const row of groupIntoRows(block)) rows.push(row)
      }

      pages.push({ num, rows, blockCount: blocks.length })
    }

    return { pageCount: doc.numPages, pagesRead, pages }
  } finally {
    await doc.destroy()
  }
}

/**
 * Split a page's items into side-by-side blocks at vertical whitespace.
 * Returns the items unsplit when no split is both available and safe.
 */
function splitIntoBlocks (items, pageWidth) {
  if (items.length === 0) return [items]

  const gutters = findGutters(items, pageWidth)
  if (gutters.length === 0) return [items]

  // Widest gutters first: a real section divider is wider than the gap between
  // a dish name and its price.
  const ranked = gutters.slice().sort((a, b) => b.width - a.width)

  let best = { blocks: [items], score: interleaveScore(groupIntoRows(items)) }

  /** Try one set of boundaries; keep it if it reads better than what we have. */
  const consider = (boundaries) => {
    const blocks = partitionByBoundaries(items, boundaries)
    if (blocks.some((block) => block.length === 0)) return
    if (!blocksLookIndependent(blocks)) return

    const score = blocks.reduce((sum, b) => sum + interleaveScore(groupIntoRows(b)), 0)
    if (score < best.score) best = { blocks, score }
  }

  // Every gutter on its own, not just the widest.
  //
  // The gap between a dish name and its price is often wider than the gap
  // between two columns of a menu. Taking the widest first and stopping there
  // split names away from their prices, which is correctly rejected - and the
  // real column gutter, being narrower, was never tried at all. Two columns
  // then merged into one row and 85 dishes on a 13-page menu lost their price.
  for (const gutter of ranked) consider([gutter.centre])

  // Then combinations, widest first, for pages with three columns.
  for (let count = 2; count <= Math.min(MAX_BLOCKS - 1, ranked.length); count += 1) {
    consider(ranked.slice(0, count).map((g) => g.centre).sort((a, b) => a - b))
  }

  return best.blocks
}

/** Vertical bands of the page width that no text crosses. */
function findGutters (items, pageWidth) {
  const buckets = Math.max(1, Math.ceil(pageWidth / SCAN_BUCKET))
  const crossings = new Array(buckets).fill(0)

  for (const item of items) {
    const width = item.width != null ? item.width : item.text.length * item.height * 0.5
    const from = Math.max(0, Math.floor(item.x / SCAN_BUCKET))
    const to = Math.min(buckets - 1, Math.ceil((item.x + width) / SCAN_BUCKET))
    for (let i = from; i <= to; i += 1) crossings[i] += 1
  }

  // A few items may cross the gap without meaning the columns are joined: a
  // heading printed across the page, or one dish name longer than its column.
  // Requiring an absolutely untouched band threw away the real gutter on a
  // page of soups and merged both columns into single rows.
  const tolerance = Math.max(1, Math.round(items.length * 0.05))
  const covered = crossings.map((count) => count > tolerance)

  const gutters = []
  let runStart = null

  for (let i = 0; i <= buckets; i += 1) {
    const empty = i < buckets && !covered[i]
    if (empty && runStart === null) {
      runStart = i
    } else if (!empty && runStart !== null) {
      const from = runStart * SCAN_BUCKET
      const to = i * SCAN_BUCKET
      // Ignore the page margins: only interior whitespace divides sections.
      if (runStart > 0 && i < buckets && to - from >= MIN_GUTTER_POINTS) {
        gutters.push({ from, to, width: to - from, centre: (from + to) / 2 })
      }
      runStart = null
    }
  }

  return gutters
}

function partitionByBoundaries (items, boundaries) {
  const blocks = Array.from({ length: boundaries.length + 1 }, () => [])

  for (const item of items) {
    const width = item.width != null ? item.width : item.text.length * item.height * 0.5
    const middle = item.x + width / 2
    let index = 0
    while (index < boundaries.length && middle > boundaries[index]) index += 1
    blocks[index].push(item)
  }

  return blocks
}

/**
 * Reject a split that separates labels from their numbers. A menu's own
 * name/price gap is a vertical gutter too, and splitting there would put every
 * dish name in one block and every price in another: the exact bug this module
 * exists to fix. Any block tall enough to matter must contain both words and
 * numbers to be believable as a section of its own.
 */
function blocksLookIndependent (blocks) {
  for (const block of blocks) {
    const rows = groupIntoRows(block)
    if (rows.length < SUBSTANTIAL_BLOCK_ROWS) continue

    const hasWords = rows.some((row) => row.some((cell) => /[A-Za-z]{3}/.test(cell)))
    const hasNumbers = rows.some((row) => row.some((cell) => /\d/.test(cell)))
    if (!hasWords || !hasNumbers) return false

    // Containing words somewhere and numbers somewhere is not enough: a column
    // of names including "Chicken 65" satisfies both while pairing nothing. A
    // real section has rows carrying a name AND its price together.
    if (pairingScore([{ num: 1, rows }]).ratio < MIN_BLOCK_PAIRING) return false
  }

  return true
}

/**
 * How many rows carry two or more separate word-like cells. Two dish names on
 * one line means two sections were merged, so lower is better.
 */
function interleaveScore (rows) {
  let score = 0
  for (const row of rows) {
    const wordCells = row.filter((cell) => /[A-Za-z]{3}/.test(cell)).length
    if (wordCells >= 2) score += wordCells - 1
  }
  return score
}

/**
 * Turn positioned text items into rows of cells.
 * Exported separately so it can be tested without a PDF.
 */
function groupIntoRows (items) {
  if (!items || items.length === 0) return []

  // Thresholds scale with the text size, so a menu set in 8pt and one set in
  // 20pt both group correctly.
  const lineHeight = median(items.map((i) => i.height)) || 10
  const yTolerance = lineHeight * Y_TOLERANCE_RATIO
  const columnGap = lineHeight * COLUMN_GAP_RATIO

  // PDF y grows upwards, so descending y reads top-down.
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)

  const bands = []
  for (const item of sorted) {
    const band = bands[bands.length - 1]
    if (band && Math.abs(band.y - item.y) <= yTolerance) {
      band.items.push(item)
    } else {
      bands.push({ y: item.y, items: [item] })
    }
  }

  return bands.map((band) => {
    const ordered = band.items.sort((a, b) => a.x - b.x)
    const cells = []
    let current = null

    for (const item of ordered) {
      const width = item.width != null ? item.width : item.text.length * item.height * 0.5
      if (current && item.x - current.endX <= columnGap) {
        // Close enough to be a word break inside one phrase, not a new column.
        current.text += (item.x - current.endX > 0.1 ? ' ' : '') + item.text
        current.endX = item.x + width
      } else {
        current = { text: item.text, endX: item.x + width }
        cells.push(current)
      }
    }

    return cells.map((cell) => cell.text)
  })
}

/**
 * Render rows as tab-separated lines for an AI prompt. Tabs are used because
 * they do not occur in menu text, so the model can rely on them as the cell
 * boundary.
 */
function rowsToText (pages, options = {}) {
  const pageMarker = options.pageMarker !== false
  const out = []

  for (const page of pages) {
    if (pageMarker) out.push('--- page ' + page.num + ' ---')
    for (const row of page.rows) {
      if (row.length > 0) out.push(row.join('\t'))
    }
  }

  return out.join('\n')
}

/**
 * How many rows look like "label ... number": a rough health check on whether
 * the pairing survived. Low means the layout did not reconstruct usefully and
 * the file should not be trusted for an unattended import.
 */
function pairingScore (pages) {
  let rows = 0
  let paired = 0
  let interleaved = 0

  for (const page of pages) {
    interleaved += interleaveScore(page.rows)
    for (const row of page.rows) {
      if (row.length === 0) continue
      rows += 1
      const hasLabel = /[A-Za-z]{3}/.test(row[0])
      const hasNumberLater = row.slice(1).some((cell) => /\d/.test(cell))
      if (hasLabel && hasNumberLater) paired += 1
    }
  }

  return { rows, paired, interleaved, ratio: rows === 0 ? 0 : paired / rows }
}

function median (numbers) {
  if (numbers.length === 0) return 0
  const sorted = numbers.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

module.exports = {
  loadPdfjs,
  extractRows,
  groupIntoRows,
  splitIntoBlocks,
  rowsToText,
  pairingScore,
  interleaveScore,
}
