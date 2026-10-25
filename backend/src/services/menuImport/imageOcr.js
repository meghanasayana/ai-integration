'use strict'

/**
 * Reading a photographed or screenshotted menu with OCR instead of a vision
 * model.
 *
 * Why
 * ---
 * A PNG or JPG has no text inside it, so the only way to read it used to be the
 * vision model - which on a CPU-only machine took several minutes per image and
 * timed out in the browser. OCR does the same job in seconds.
 *
 * The real win is that OCR reports WHERE each word sits, which is exactly what
 * pdfjs gives for a PDF. So an image becomes just another source of positioned
 * words and flows into the same machinery that already works:
 *
 *   PDF   -> pdfjs    -> words + positions -+
 *                                           +-> split columns -> rows -> parse
 *   Image -> this file -> words + positions -+
 *
 * One coordinate detail matters: an image measures y downwards from the top, a
 * PDF measures it upwards from the bottom. The y values are negated here so the
 * shared row grouping sees the same convention and reads top-to-bottom. Get that
 * wrong and the menu comes out upside down.
 *
 * tesseract.js downloads its language data (about 15MB) the first time it runs,
 * so the first image is slower and needs a working internet connection. After
 * that it is cached.
 */

const { splitIntoBlocks, groupIntoRows } = require('./pdfLayout')

/** Words read less confidently than this are dropped as noise. */
const MIN_WORD_CONFIDENCE = 40

class OcrError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OcrError'
    this.code = code
  }
}

/** tesseract.js is optional: absent means the image path is unavailable. */
function loadTesseract() {
  try {
    return require('tesseract.js')
  } catch (err) {
    throw new OcrError(
      'ocr_missing',
      'Reading photos needs the tesseract.js package. Run: npm install tesseract.js',
    )
  }
}

/**
 * Flatten the nested OCR result into a plain list of words.
 * tesseract.js nests them blocks -> paragraphs -> lines -> words.
 */
function collectWords(page) {
  const words = []
  for (const block of (page && page.blocks) || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          if (!word || typeof word.text !== 'string') continue
          if (word.text.trim() === '') continue
          if (typeof word.confidence === 'number' && word.confidence < MIN_WORD_CONFIDENCE) continue
          words.push(word)
        }
      }
    }
  }
  return words
}

/**
 * Turn OCR words into the positioned items the shared row grouping expects.
 *
 * Exported so the conversion can be tested without running OCR, which needs a
 * network download and a real image.
 */
function wordsToItems(words) {
  const items = []

  for (const word of words || []) {
    const box = word && word.bbox
    if (!box) continue

    const height = Math.abs(box.y1 - box.y0) || 10
    items.push({
      text: String(word.text).trim(),
      x: box.x0,
      // Negated: an image counts y downwards, a PDF upwards, and the row
      // grouping is written for the PDF convention.
      y: -box.y0,
      height,
      width: Math.abs(box.x1 - box.x0) || String(word.text).length * height * 0.5,
      confidence: word.confidence,
    })
  }

  return items
}

/** Widest right edge seen, used to find the column gutters. */
function estimateWidth(items) {
  let widest = 0
  for (const item of items) {
    const right = item.x + (item.width || 0)
    if (right > widest) widest = right
  }
  return widest > 0 ? widest : 1000
}

/**
 * Read an image into rows of cells.
 *
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {string} [options.lang]      tesseract language, default 'eng'
 * @param {boolean} [options.splitColumns]
 * @returns {Promise<{rows: string[][], words: number, confidence: number}>}
 */
async function extractImageRows(buffer, options = {}) {
  const { createWorker } = loadTesseract()
  const lang = options.lang || process.env.OCR_LANG || 'eng'

  let worker
  try {
    worker = await createWorker(lang)
  } catch (err) {
    throw new OcrError(
      'ocr_setup_failed',
      'OCR could not start. It downloads its language data on first use, so this ' +
        'usually means no internet connection. (' + err.message + ')',
    )
  }

  let page
  try {
    // blocks: true is required - without it the result carries no word
    // positions at all, only a flat string, which loses the whole point.
    const result = await worker.recognize(buffer, {}, { blocks: true })
    page = result.data
  } catch (err) {
    throw new OcrError('ocr_failed', 'That image could not be read: ' + err.message)
  } finally {
    try {
      await worker.terminate()
    } catch {
      // A worker that will not shut down must not fail the request.
    }
  }

  const words = collectWords(page)
  if (words.length === 0) {
    throw new OcrError(
      'no_text_found',
      'No readable text was found in that image. Try a sharper, straighter photo ' +
        'with the menu filling the frame.',
    )
  }

  const items = wordsToItems(words)
  const pageWidth = estimateWidth(items)

  const blocks =
    options.splitColumns === false ? [items] : splitIntoBlocks(items, pageWidth)

  const rows = []
  for (const block of blocks) {
    for (const row of groupIntoRows(block)) rows.push(row)
  }

  return {
    rows,
    // The positioned words as well as the rows. Rows are enough for dishes,
    // but a combo box is a two-dimensional thing and needs the coordinates.
    items,
    pageWidth,
    words: words.length,
    confidence: typeof page.confidence === 'number' ? page.confidence : null,
  }
}

module.exports = {
  extractImageRows,
  wordsToItems,
  collectWords,
  OcrError,
  MIN_WORD_CONFIDENCE,
}
