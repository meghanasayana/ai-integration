'use strict'

/**
 * Text extraction from PDFs that carry a text layer.
 *
 * Two extraction modes, in order of preference:
 *
 *   rows  Position-based reconstruction (pdfLayout.js). Rebuilds each visual
 *         line from the x/y position of every text item, so a dish keeps its
 *         own price even when the PDF drew the whole name column before the
 *         whole price column.
 *
 *   flat  Plain pdf-parse text, in the order the PDF stores it. Kept as a
 *         fallback for documents where position-based reconstruction finds
 *         little structure, e.g. a menu written as prose paragraphs.
 *
 * Rows are used only when enough of them actually pair a name with a number.
 * That check matters: on a column-drawn menu, flat text yields lines holding a
 * name OR a price but never both, which leaves the model guessing - and a
 * guessed price is worse than a failed import.
 *
 * Scanned (image-only) PDFs are NOT supported in this build. Rendering PDF
 * pages to images needs a native canvas dependency that is awkward to install
 * on Windows, so rather than half-support it we detect the case and say so.
 *
 * pdf-parse changed its API between v1 and v2:
 *   v1  module.exports = (buffer) => Promise<{ text, numpages }>
 *   v2  module.exports = { PDFParse: class }  /  { pdf: fn }
 *
 * Both are supported below. Getting this wrong cost us real time: the v2
 * object was being called as a function, which threw "parse is not a
 * function", which this file's catch-all then reported as "corrupt or
 * encrypted" - blaming the user's file for our bug.
 */

const { MAX_PDF_PAGES, MIN_TEXT_CHARS_PER_PDF } = require('./fileSupport')
const { extractRows, rowsToText, pairingScore } = require('./pdfLayout')

/**
 * Share of rows that must pair a label with a number before the row-based
 * reconstruction is trusted over plain text. Flat text on a column-drawn menu
 * scores near zero here, so this cleanly separates the two cases.
 */
const MIN_PAIRING_RATIO = 0.25

class PdfError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PdfError'
    this.code = code
  }
}

/** Returns a function (buffer) => Promise<result>, whichever version is installed. */
function loadParser() {
  let mod
  try {
    mod = require('pdf-parse')
  } catch (err) {
    throw new PdfError(
      'dependency_missing',
      'PDF support needs the pdf-parse package. Run: npm install pdf-parse',
    )
  }

  if (typeof mod === 'function') return mod                 // v1
  if (mod && typeof mod.pdf === 'function') return mod.pdf   // v2
  if (mod && typeof mod.default === 'function') return mod.default
  if (mod && typeof mod.PDFParse === 'function') {
    return async (buffer) => {
      const instance = new mod.PDFParse({ data: buffer })
      try {
        return await instance.getText()
      } finally {
        if (typeof instance.destroy === 'function') await instance.destroy()
      }
    }
  }

  throw new PdfError(
    'incompatible_parser',
    `The installed pdf-parse version exposes no usable function (saw: ${
      mod && typeof mod === 'object' ? Object.keys(mod).join(', ') || 'no keys' : typeof mod
    }). Run: npm install pdf-parse@1.1.1`,
  )
}

/** Different versions name these differently. */
function readPageCount(result) {
  return result.numpages ?? result.total ?? result.pages ?? 0
}

function readText(result) {
  if (typeof result.text === 'string') return result.text
  if (Array.isArray(result.pages)) {
    return result.pages.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n')
  }
  return ''
}

function assertPageLimit(pages) {
  if (pages > MAX_PDF_PAGES) {
    throw new PdfError(
      'too_many_pages',
      `That PDF has ${pages} pages. The limit is ${MAX_PDF_PAGES}.`,
    )
  }
}

/** Plain text in the PDF's own storage order. */
async function extractPdfText(buffer) {
  const parse = loadParser()

  let result
  try {
    result = await parse(buffer)
  } catch (err) {
    // Report what actually went wrong instead of assuming corruption.
    if (/password|encrypt/i.test(err.message || '')) {
      throw new PdfError(
        'encrypted_pdf',
        'That PDF is password protected. Save an unprotected copy and try again.',
      )
    }
    throw new PdfError('unreadable_pdf', `That PDF could not be read: ${err.message}`)
  }

  const pages = readPageCount(result)
  assertPageLimit(pages)

  return { text: readText(result).trim(), pages }
}

/** Rows rebuilt from text-item positions. Returns null if that yields nothing. */
async function extractPdfRows(buffer) {
  let layout
  try {
    layout = await extractRows(buffer, { maxPages: MAX_PDF_PAGES })
  } catch (err) {
    if (/password|encrypt/i.test(err.message || '')) {
      throw new PdfError(
        'encrypted_pdf',
        'That PDF is password protected. Save an unprotected copy and try again.',
      )
    }
    // Not fatal: the caller still has plain text to fall back on.
    return null
  }

  assertPageLimit(layout.pageCount)

  const score = pairingScore(layout.pages)
  if (score.rows === 0) return null

  // Per-page text as well as the whole document: the model reads one page at a
  // time, because a single request for a long menu is slow on CPU and was what
  // produced an empty response in testing.
  const pagesText = layout.pages
    .map((page) => ({
      num: page.num,
      text: rowsToText([page], { pageMarker: false }),
      // The rows themselves, so what the model returns can be checked against
      // what it was given rather than taken on trust.
      rows: page.rows,
      pairing: pairingScore([page]),
    }))
    .filter((page) => page.text.trim() !== '')

  return {
    text: rowsToText(layout.pages),
    pagesText,
    pages: layout.pageCount,
    pairing: score,
  }
}

/**
 * Best available text for the model, with the mode used.
 *
 * @returns {Promise<{text: string, pages: number, mode: 'rows'|'flat', pairing?: object}>}
 */
async function extractPdfContent(buffer) {
  const rows = await extractPdfRows(buffer)

  if (rows && rows.pairing.ratio >= MIN_PAIRING_RATIO) {
    assertTextPresent(rows.text)
    return {
      text: rows.text,
      pagesText: rows.pagesText,
      pages: rows.pages,
      mode: 'rows',
      pairing: rows.pairing,
    }
  }

  // Either reconstruction found no structure worth trusting, or it failed
  // outright. Fall back to plain text rather than refusing the file.
  const flat = await extractPdfText(buffer)
  assertTextPresent(flat.text)

  return {
    text: flat.text,
    pages: flat.pages || (rows ? rows.pages : 0),
    mode: 'flat',
    pairing: rows ? rows.pairing : undefined,
  }
}

function assertTextPresent(text) {
  if (!text || text.trim().length < MIN_TEXT_CHARS_PER_PDF) {
    throw new PdfError(
      'scanned_pdf',
      'This looks like a scanned PDF with no selectable text. Scanned PDFs are not supported yet - please upload a photo or screenshot of the menu instead.',
    )
  }
}

module.exports = { extractPdfContent, extractPdfText, extractPdfRows, PdfError }
