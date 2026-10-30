'use strict'

/**
 * Menu import - extraction pipeline.
 *
 * File in, reviewable plan out. Performs NO database work: nothing here reads
 * or writes Prisma. Saving the plan is a separate, later step the admin
 * triggers after reviewing it.
 *
 *   classify -> image      -> model -> validate -> plan
 *            -> pdf rows   -> parse directly, model for leftovers -> plan
 *            -> pdf text   -> model -> validate -> plan
 *
 * Why rows are parsed rather than sent to the model
 * -------------------------------------------------
 * The hard part of reading a menu is pairing each dish with its own price, and
 * pdfLayout.js solves that from the position of every word. Once a row reads
 * "Chicken Masala <TAB> 220" there is no judgement left, and on this machine
 * the model writes at about 4.7 tokens a second, so retyping a 12-page menu as
 * JSON takes around half an hour. Parsing the same rows takes seconds.
 *
 * The model is still used, for the rows the parser will not guess at: an
 * unlabelled "110 / 140", a price column holding words, a layout the parser
 * does not recognise. That is the work it is actually better at.
 */

const { classifyUpload } = require('./fileSupport')
const { extractPdfContent, PdfError } = require('./pdfText')
const { extractFromImage, extractFromText, extractFromRows, OllamaError } = require('./ollama')
const { validateAiOutput } = require('./validateAiOutput')
const { buildImportPlan } = require('./buildImportPlan')
const { mergeCategories } = require('./mergePages')
const { verifyCoverage, rowsNotRepresented, dropInvented } = require('./verifyCoverage')
const { parseRows, splitNameAndPrices } = require('./parseRows')
const { extractImageRows, OcrError } = require('./imageOcr')
const { extractCombosFromPdf, combosFromItems, asPlan: combosAsPlan } = require('./comboExtract')

/** Longest pasted menu accepted. Keeps one request small enough to stay quick. */
const MAX_PASTE_CHARS = 8000

/** Rows sent to the model in one request when the parser could not read them. */
const LEFTOVER_BATCH = 40

/** Most leftover rows worth sending at all; beyond this something is wrong. */
const MAX_LEFTOVERS = 160

/**
 * How many unreadable rows are worth waiting for the model over.
 *
 * On a CPU-only machine each request costs a minute or more, so asking about
 * forty rows means the admin waits several minutes to see a menu the parser
 * already read in three seconds. Past this many, the rows go straight to the
 * review list instead - visible, editable, and not holding up the rest. A few
 * stragglers are still worth asking about, because answering them is quick.
 *
 * Set MENU_IMPORT_AI_LEFTOVERS=always to ask however many there are.
 */
const AI_LEFTOVER_LIMIT = Number(process.env.MENU_IMPORT_AI_LEFTOVER_LIMIT || 12)

function shouldAskModel(count) {
  if (process.env.MENU_IMPORT_AI_LEFTOVERS === 'always') return count > 0
  if (process.env.MENU_IMPORT_AI_LEFTOVERS === 'never') return false
  return count > 0 && count <= AI_LEFTOVER_LIMIT
}

/**
 * Rows the parser could not read, as entries for the review list.
 *
 * They arrive with no price, which the review step already shows as "enter a
 * price" - so a row nobody could read becomes a line the admin can fix, rather
 * than something dropped quietly or something they wait minutes for.
 */
/**
 * Add a category list to the collection merged at the end.
 *
 * mergeCategories takes a list of category LISTS and quietly skips anything
 * that is not an array, so pushing a single category object into it loses that
 * category without an error. That is how 44 unreadable rows disappeared from
 * the review screen while the code looked correct.
 */
function pushList(lists, categoryList) {
  if (Array.isArray(categoryList) && categoryList.length > 0) lists.push(categoryList)
}

function rowsAsReviewItems(rows) {
  const items = []

  for (const row of rows) {
    const cells = row.map((c) => String(c).trim()).filter((c) => c !== '')
    if (cells.length === 0) continue

    const split = splitNameAndPrices(cells[0])
    const name = split.name || cells[0]
    if (!/[A-Za-z]{2}/.test(name)) continue

    // No price: deliberately. Printing one here would mean inventing it.
    items.push({ name, printedAs: cells.join('  ') })
  }

  return items.length > 0 ? [{ name: 'Needs checking', items }] : []
}

function invalidOutput(validated, raw) {
  return {
    ok: false,
    code: 'invalid_ai_output',
    message:
      'The AI did not return a readable menu. Try a clearer photo, or a smaller section of the menu.',
    details: validated.errors.slice(0, 5),
    rawPreview: String(raw).slice(0, 400),
  }
}

/** Rows as tab-separated text, with any label rows kept for context. */
function rowsAsText(rows, contextRows = []) {
  const headings = contextRows.filter(
    (row) => Array.isArray(row) && row.length > 0 && !row.slice(1).some((c) => /\d/.test(c)),
  )
  const lines = headings.slice(0, 3).map((row) => row.join('\t'))
  for (const row of rows) lines.push(row.join('\t'))
  return lines.join('\n')
}

/**
 * Ask the model about the rows the parser would not guess at.
 * Returns the categories it managed, plus whatever is still missing.
 */
async function readLeftovers(unparsed, allRows, options) {
  const rows = unparsed.slice(0, MAX_LEFTOVERS)
  const collected = []
  const failures = []

  for (let start = 0; start < rows.length; start += LEFTOVER_BATCH) {
    const batch = rows.slice(start, start + LEFTOVER_BATCH)
    console.log(
      `[menuImport] asking the model about ${batch.length} row(s) the parser left`,
    )

    let aiResult
    try {
      aiResult = await extractFromRows({ rowsText: rowsAsText(batch, allRows), ...options })
    } catch (err) {
      if (!(err instanceof OllamaError)) throw err
      failures.push({ code: err.code, message: err.message, rows: batch.map((r) => r.join('\t')) })
      console.error(`[menuImport] leftover batch failed: ${err.code}`)
      continue
    }

    const validated = validateAiOutput(aiResult.raw)
    if (!validated.ok) {
      failures.push({
        code: 'invalid_ai_output',
        message: validated.errors.slice(0, 3).join('; '),
        rows: batch.map((r) => r.join('\t')),
      })
      continue
    }

    // The model may re-read the rows it was given and nothing else. Asked
    // about rows it cannot parse, a small model writes a plausible dish
    // rather than admitting defeat: a cafe menu came back with a "Chicken
    // Biryani" priced "400220140", neither of which was on the page.
    const checked = dropInvented(validated.categories, batch)
    if (checked.invented.length > 0) {
      console.warn(
        `[menuImport] dropped ${checked.invented.length} dish(es) the model invented: ` +
          checked.invented.map((d) => `"${d.name}" (${d.price})`).join(', '),
      )
      failures.push({
        code: 'invented_dishes',
        message:
          `${checked.invented.length} dish(es) the AI returned were not on the page ` +
          'and were discarded.',
        rows: checked.invented.map((d) => `${d.name}\t${d.price}`),
      })
    }

    collected.push(checked.categories)

    const coverage = verifyCoverage(batch, checked.categories)
    if (coverage.missingRows.length > 0) {
      failures.push({
        code: 'rows_not_returned',
        message: `${coverage.missingRows.length} row(s) the AI did not return`,
        rows: coverage.missingRows.map((r) => r.join('\t')),
      })
    }
  }

  if (unparsed.length > MAX_LEFTOVERS) {
    failures.push({
      code: 'too_many_unreadable',
      message:
        `${unparsed.length - MAX_LEFTOVERS} further row(s) were not attempted. ` +
        'This file may not be laid out as a table.',
      rows: unparsed.slice(MAX_LEFTOVERS).map((r) => r.join('\t')),
    })
  }

  return { categories: collected, failures }
}

/**
 * Read a photo with OCR and parse the rows it produces.
 *
 * Returns null when OCR is unavailable or produced nothing usable, so the
 * caller can fall back to the vision model rather than refusing the file.
 */
async function readImageByOcr(buffer, options) {
  let ocr
  try {
    ocr = await extractImageRows(buffer)
  } catch (err) {
    if (!(err instanceof OcrError)) throw err
    console.warn(`[menuImport] OCR unavailable (${err.code}): falling back to the vision model`)
    return null
  }

  // Combos first, for the same reason as the PDF path: a photographed combo
  // page run through the dish parser turns "Combo - 8" into a dish costing 8.
  let combos = []
  try {
    combos = combosAsPlan(combosFromItems(ocr.items || [], ocr.pageWidth))
  } catch (err) {
    console.warn('[menuImport] combo pass on the photo failed:', err.message)
  }

  // Two or more boxes means the whole picture is a combo page, so there are no
  // dishes on it to find. One alone is more likely a heading that happens to
  // read as a title, so the dish parser still gets its turn.
  if (combos.length >= 2) {
    console.log(
      `[menuImport] image read by OCR: ${ocr.words} words -> ` +
        `${combos.length} combos, no dish parsing (whole page is combos)`,
    )
    return {
      categories: [],
      failures: [],
      combos,
      stats: { words: ocr.words, ocrConfidence: ocr.confidence, dishes: 0, ambiguous: 0, unparsed: 0 },
    }
  }

  const parsed = parseRows(ocr.rows)
  console.log(
    `[menuImport] image read by OCR: ${ocr.words} words, confidence ` +
      `${ocr.confidence === null ? '?' : Math.round(ocr.confidence)} -> ` +
      `${parsed.stats.dishes} dishes, ${parsed.stats.unparsed} unreadable` +
      `${combos.length > 0 ? `, ${combos.length} combo` : ''}`,
  )

  // No dishes and no combos means OCR read something but not a menu, so the
  // vision model deserves its turn.
  if (parsed.stats.dishes === 0 && combos.length === 0) return null

  const lists = [parsed.categories]
  let failures = []

  if (shouldAskModel(parsed.unparsed.length)) {
    const leftovers = await readLeftovers(parsed.unparsed, ocr.rows, options)
    for (const list of leftovers.categories) lists.push(list)
    failures = leftovers.failures
  }

  pushList(lists, rowsAsReviewItems(rowsNotRepresented(parsed.unparsed, mergeCategories(lists))))

  return {
    categories: mergeCategories(lists),
    failures,
    combos,
    stats: {
      words: ocr.words,
      ocrConfidence: ocr.confidence,
      dishes: parsed.stats.dishes,
      ambiguous: parsed.stats.ambiguous,
      unparsed: parsed.stats.unparsed,
    },
  }
}

/**
 * Read a PDF whose rows reconstructed cleanly: parse what is unambiguous, and
 * ask the model only about what is not.
 */
async function readPdfRows(content, options) {
  const allRows = []
  for (const page of content.pagesText) {
    for (const row of page.rows) allRows.push(row)
  }

  const parsed = parseRows(allRows)
  console.log(
    `[menuImport] parsed directly: ${parsed.stats.dishes} dishes in ` +
      `${parsed.stats.categories} categories, ${parsed.stats.ambiguous} to review, ` +
      `${parsed.stats.unparsed} for the model`,
  )

  if (parsed.stats.dishes === 0) return null

  const lists = [parsed.categories]
  let failures = []
  let aiUsed = false

  let skippedForSpeed = 0

  if (shouldAskModel(parsed.unparsed.length)) {
    const leftovers = await readLeftovers(parsed.unparsed, allRows, options)
    for (const list of leftovers.categories) lists.push(list)
    failures = leftovers.failures
    aiUsed = leftovers.categories.length > 0

    // Whatever the model did not return - because it was unreachable, slow, or
    // simply left a row out - still has to reach the screen. A row reported
    // only in the response is a row the admin never sees.
    const stillMissing = rowsNotRepresented(parsed.unparsed, mergeCategories(lists))
    pushList(lists, rowsAsReviewItems(stillMissing))
  } else if (parsed.unparsed.length > 0) {
    skippedForSpeed = parsed.unparsed.length
    pushList(lists, rowsAsReviewItems(parsed.unparsed))
    console.log(
      `[menuImport] ${skippedForSpeed} unreadable row(s) sent to the review list ` +
        'rather than the model, which would have taken minutes',
    )
  }

  return {
    categories: mergeCategories(lists),
    failures,
    stats: { ...parsed.stats, aiUsed, skippedForSpeed },
  }
}

/**
 * @param {{buffer: Buffer, mimetype: string, size: number, originalname: string}} file
 * @returns {Promise<{ok: boolean, plan?: object, meta?: object, code?: string, message?: string}>}
 */
async function extractMenuPlan(file, options = {}) {
  const classification = classifyUpload(file)
  if (!classification.ok) {
    return { ok: false, code: classification.code, message: classification.message }
  }

  const startedAt = Date.now()
  let categories
  let model
  let source = {}
  let partial = null
  let comboPlan = []
  let comboPages = new Set()

  try {
    if (classification.kind === 'image') {
      // OCR first. It reports where each word sits, so a photo becomes the same
      // positioned-word input a PDF gives and flows into the parser that
      // already works - seconds instead of the several minutes the vision model
      // takes on a CPU.
      const fromOcr = await readImageByOcr(file.buffer, options)

      if (fromOcr) {
        categories = fromOcr.categories
        comboPlan = fromOcr.combos || []
        partial = fromOcr.failures.length > 0 ? fromOcr.failures : null
        source = { kind: 'image', mode: 'ocr', ...fromOcr.stats }
      } else {
        // OCR found text but no dishes in it, or is not installed. The vision
        // model is the fallback: slow, but it reads layouts OCR cannot.
        const aiResult = await extractFromImage({
          base64Image: file.buffer.toString('base64'),
          ...options,
        })
        const validated = validateAiOutput(aiResult.raw)
        if (!validated.ok) return invalidOutput(validated, aiResult.raw)

        categories = validated.categories
        model = aiResult.model
        source = { kind: 'image', mode: 'vision' }
      }
    } else {
      // Combos are read first so the dish parser can be told to leave their
      // pages alone. A combo page run through the dish parser produces
      // nonsense: "Combo - 8" becomes a dish called "Combo" costing 8, and
      // the items inside each box scatter into the review list.
      try {
        const found = await extractCombosFromPdf(file.buffer)
        comboPlan = combosAsPlan(found.combos)
        comboPages = new Set(found.pagesWithCombos)
        if (comboPlan.length > 0) {
          console.log(
            `[menuImport] ${comboPlan.length} combo(s) found on page(s) ` +
              `${found.pagesWithCombos.join(', ')} - those pages are not read for dishes`,
          )
        }
      } catch (err) {
        console.warn('[menuImport] combo pass failed, dishes unaffected:', err.message)
      }

      const content = await extractPdfContent(file.buffer)
      console.log(
        `[menuImport] pdf read as ${content.mode}` +
          (content.pairing
            ? ` (${content.pairing.paired}/${content.pairing.rows} rows paired, ` +
              `${content.pairing.interleaved} interleaved)`
            : ''),
      )

      // A page belongs to one or the other, never both.
      const dishContent = comboPages.size > 0 && Array.isArray(content.pagesText)
        ? { ...content, pagesText: content.pagesText.filter((page) => !comboPages.has(page.num)) }
        : content

      const fromRows =
        dishContent.mode === 'rows' && Array.isArray(dishContent.pagesText)
          ? await readPdfRows(dishContent, options)
          : null

      if (fromRows) {
        categories = fromRows.categories
        partial = fromRows.failures.length > 0 ? fromRows.failures : null
        source = {
          kind: 'pdf',
          pages: content.pages,
          mode: 'rows',
          pairing: content.pairing,
          ...fromRows.stats,
        }
      } else {
        // The layout gave nothing to parse, so fall back to handing the whole
        // text to the model.
        const aiResult =
          content.mode === 'rows'
            ? await extractFromRows({ rowsText: content.text, ...options })
            : await extractFromText({ menuText: content.text, ...options })

        const validated = validateAiOutput(aiResult.raw)
        if (!validated.ok) return invalidOutput(validated, aiResult.raw)

        categories = validated.categories
        model = aiResult.model
        source = {
          kind: 'pdf',
          pages: content.pages,
          mode: content.mode,
          pairing: content.pairing,
          textLength: content.text.length,
        }
      }
    }
  } catch (err) {
    if (err instanceof PdfError || err instanceof OllamaError || err instanceof OcrError) {
      return { ok: false, code: err.code, message: err.message }
    }
    // Never surface an unexpected internal error to the browser.
    return {
      ok: false,
      code: 'extraction_failed',
      message: 'The menu could not be read. Please try again.',
      internal: err.message,
    }
  }

  return {
    ok: true,
    plan: buildImportPlan(categories),
    combos: comboPlan,
    // Rows that could not be read are reported, not hidden: an import that
    // silently covers part of a menu looks complete and is not.
    partial,
    meta: { ...source, model, durationMs: Date.now() - startedAt, filename: file.originalname },
  }
}

/** Pasted text, split into cells on tabs or runs of spaces. */
function textToRows(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter((c) => c !== ''))
    .filter((cells) => cells.length > 0)
}

/**
 * The same pipeline, from text the admin pasted in rather than a file.
 *
 * Pasted menu lines are rows too, so they are parsed directly first and only
 * the leftovers reach the model. A short section then comes back in about a
 * second rather than a minute.
 */
async function extractMenuPlanFromText(text, options = {}) {
  const menuText = String(text || '').trim()

  if (menuText === '') {
    return { ok: false, code: 'empty_text', message: 'Paste some menu text first.' }
  }

  if (menuText.length > MAX_PASTE_CHARS) {
    return {
      ok: false,
      code: 'text_too_long',
      message:
        `That is ${menuText.length} characters; the limit is ${MAX_PASTE_CHARS}. ` +
        'Paste one section at a time, or upload the file instead.',
    }
  }

  const startedAt = Date.now()
  const rows = textToRows(menuText)
  const parsed = parseRows(rows)

  console.log(
    `[menuImport] pasted text: ${parsed.stats.dishes} dishes parsed directly, ` +
      `${parsed.stats.unparsed} for the model`,
  )

  let categories
  let model
  let partial = null
  let mode

  if (parsed.stats.dishes > 0) {
    mode = 'pasted-rows'
    const lists = [parsed.categories]

    if (shouldAskModel(parsed.unparsed.length)) {
      try {
        const leftovers = await readLeftovers(parsed.unparsed, rows, options)
        for (const list of leftovers.categories) lists.push(list)
        partial = leftovers.failures.length > 0 ? leftovers.failures : null
      } catch (err) {
        if (!(err instanceof OllamaError)) throw err
        partial = [{ code: err.code, message: err.message }]
      }

      // Same rule as the file path: anything the model did not return goes to
      // the review list rather than being lost.
      const stillMissing = rowsNotRepresented(parsed.unparsed, mergeCategories(lists))
      pushList(lists, rowsAsReviewItems(stillMissing))
    } else if (parsed.unparsed.length > 0) {
      pushList(lists, rowsAsReviewItems(parsed.unparsed))
    }

    categories = mergeCategories(lists)
  } else {
    // Prose rather than a list: the model is the right tool.
    mode = 'pasted-text'
    let aiResult
    try {
      aiResult = await extractFromText({ menuText, ...options })
    } catch (err) {
      if (err instanceof OllamaError) {
        return { ok: false, code: err.code, message: err.message }
      }
      return {
        ok: false,
        code: 'extraction_failed',
        message: 'The menu text could not be read. Please try again.',
        internal: err.message,
      }
    }

    const validated = validateAiOutput(aiResult.raw)
    if (!validated.ok) return invalidOutput(validated, aiResult.raw)

    categories = validated.categories
    model = aiResult.model
  }

  return {
    ok: true,
    plan: buildImportPlan(categories),
    partial,
    meta: {
      kind: 'text',
      mode,
      textLength: menuText.length,
      dishes: parsed.stats.dishes,
      ambiguous: parsed.stats.ambiguous,
      unparsed: parsed.stats.unparsed,
      model,
      durationMs: Date.now() - startedAt,
      filename: 'pasted text',
    },
  }
}

module.exports = {
  extractMenuPlan,
  extractMenuPlanFromText,
  MAX_PASTE_CHARS,
  textToRows,
  // re-exported so routes and tests can use the pieces directly
  classifyUpload,
  validateAiOutput,
  buildImportPlan,
  mergeCategories,
  parseRows,
}
