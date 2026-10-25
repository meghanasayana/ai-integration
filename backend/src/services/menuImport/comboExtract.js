const { loadPdfjs } = require('./pdfLayout')
const { boxesFromItems } = require('./comboBoxes')
const { isComboTitle, parseComboBlock, tidyCombos } = require('./comboBlocks')
const { inferDiet } = require('./dietFromName')

/**
 * Pulling combos out of an uploaded menu.
 *
 * This runs as its own pass over the file rather than hooking into the dish
 * extraction. Dish reading is the part that took the longest to get right,
 * and a combo page looks nothing like a page of dishes: reusing that path
 * would mean teaching it to behave two ways at once. A second read of the
 * file costs a second or two and leaves the dish path untouched.
 */

const MAX_PAGES = 20

/** Positioned text items for one page, in the shape comboBoxes expects. */
const itemsFromPage = (content, defaultHeight = 10) =>
  content.items
    .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
      height: Math.abs(item.transform[3]) || Math.abs(item.height) || defaultHeight,
      width: item.width,
    }))

/**
 * Combos from positioned items, whatever produced them: a PDF page or the
 * words an OCR pass found in a photograph.
 */
const combosFromItems = (items, pageWidth) =>
  tidyCombos(
    boxesFromItems(items, pageWidth, isComboTitle)
      .map((box) => parseComboBlock(box.title, box.lines)),
  )

/**
 * @returns {Promise<{combos: Array, pagesWithCombos: number[]}>}
 */
async function extractCombosFromPdf(buffer, options = {}) {
  const maxPages = options.maxPages || MAX_PAGES
  const pdfjs = await loadPdfjs()

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    // The PDF is untrusted input: never let it drive expression evaluation.
    isEvalSupported: false,
  }).promise

  try {
    const pagesRead = Math.min(doc.numPages, maxPages)
    const combos = []
    const pagesWithCombos = []

    for (let num = 1; num <= pagesRead; num += 1) {
      const page = await doc.getPage(num)
      let found = []
      try {
        const view = page.view || [0, 0, 595, 842]
        const content = await page.getTextContent()
        found = combosFromItems(itemsFromPage(content), view[2] - view[0])
      } finally {
        page.cleanup()
      }

      if (found.length > 0) {
        pagesWithCombos.push(num)
        for (const combo of found) combos.push({ ...combo, page: num })
      }
    }

    return { combos, pagesWithCombos }
  } finally {
    await doc.destroy()
  }
}

/**
 * Combos from a photographed menu. OCR words carry a bounding box with y
 * growing downwards, the opposite of a PDF, so y is negated to put the top
 * of the page first.
 */
function extractCombosFromWords(words, pageWidth) {
  const items = (words || [])
    .filter((word) => word && String(word.text ?? '').trim() !== '')
    .map((word) => {
      const box = word.bbox || {}
      const height = Math.abs((box.y1 ?? 0) - (box.y0 ?? 0)) || 10
      return {
        text: String(word.text).trim(),
        x: box.x0 ?? 0,
        y: -(box.y0 ?? 0),
        height,
        width: Math.abs((box.x1 ?? 0) - (box.x0 ?? 0)) || undefined,
      }
    })

  return combosFromItems(items, pageWidth)
}

/** Drop the working fields the browser has no use for. */
const asPlan = (combos) =>
  combos.map((combo, index) => {
    // Read the whole box at once: a combo is vegetarian only when nothing in
    // it is meat. Anything the guess is unsure about stays non-veg, which is
    // the direction that cannot mislead someone who does not eat meat.
    const guess = inferDiet(combo.lines.join(' '), '')

    return {
      name: combo.name,
      price: combo.price,
      lines: combo.lines,
      isVeg: guess.isVeg === true,
      needsReview: combo.needsReview,
      reason: combo.reason,
      page: combo.page ?? null,
      sortOrder: index,
    }
  })

module.exports = {
  extractCombosFromPdf,
  extractCombosFromWords,
  combosFromItems,
  asPlan,
  MAX_PAGES,
}
