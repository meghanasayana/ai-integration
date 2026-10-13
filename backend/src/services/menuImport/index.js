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
const { verifyCoverage, rowsNotRepresented } = require('./verifyCoverage')
const { parseRows, splitNameAndPrices } = require('./parseRows')

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

    collected.push(validated.categories)

    const coverage = verifyCoverage(batch, validated.categories)
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

  try {
    if (classification.kind === 'image') {
      const aiResult = await extractFromImage({
        base64Image: file.buffer.toString('base64'),
        ...options,
      })
      const validated = validateAiOutput(aiResult.raw)
      if (!validated.ok) return invalidOutput(validated, aiResult.raw)

      categories = validated.categories
      model = aiResult.model
      source = { kind: 'image' }
    } else {
      const content = await extractPdfContent(file.buffer)
      console.log(
        `[menuImport] pdf read as ${content.mode}` +
          (content.pairing
            ? ` (${content.pairing.paired}/${content.pairing.rows} rows paired, ` +
              `${content.pairing.interleaved} interleaved)`
            : ''),
      )

      const fromRows =
        content.mode === 'rows' && Array.isArray(content.pagesText)
          ? await readPdfRows(content, options)
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
    if (err instanceof PdfError || err instanceof OllamaError) {
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
