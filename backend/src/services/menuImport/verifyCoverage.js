'use strict'

/**
 * Did the model return every dish on the page?
 *
 * A local model asked to read a full page sometimes stops after the first
 * section and reports itself finished. Observed on page 5 of a real menu:
 * 30 dish rows in two sections, 17 returned, `done_reason=stop`, and nothing
 * in the output suggesting anything was missing.
 *
 * That is worse than an error. An error gets noticed; a partial menu that
 * reports "17 ready, 0 needing review" gets confirmed, and two thirds of a
 * section quietly never reaches the database.
 *
 * The rows we sent are known, so coverage is checkable rather than a matter of
 * trust: every row that looks like a dish must come back as a dish.
 */

/** Loose match: ignores case, spacing and punctuation. */
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A row offering a name and at least one number is a dish we expect back. */
function isDishRow(row) {
  if (!Array.isArray(row) || row.length === 0) return false
  const name = row[0]
  if (!/[A-Za-z]{3}/.test(name)) return false
  // Either a later cell has a price, or the name cell has one merged into it,
  // as happens when a long dish name runs close to its price column.
  return row.slice(1).some((cell) => /\d/.test(cell)) || /\s\d{2,4}$/.test(name)
}

/**
 * Strip a merged trailing price and any decorative prefix, so the row's name
 * can be compared with what the model returned.
 */
function rowName(row) {
  let name = String(row[0] || '')
  // "Pepper Barbeque Chicken 450 250 160" -> "Pepper Barbeque Chicken"
  name = name.replace(/(\s+\d{1,4}(\.\d{1,2})?)+\s*$/, '')
  return normalise(name)
}

function extractedNames(categories) {
  const names = new Set()
  for (const category of categories || []) {
    for (const item of (category && category.items) || []) {
      if (item && item.name) names.add(normalise(item.name))
    }
  }
  return names
}

/**
 * Compare the rows sent against the dishes returned.
 *
 * A row counts as covered when its name matches a returned dish, or when one
 * contains the other - the model may legitimately tidy "Chicken 65 Bone (8
 * Pcs)" into "Chicken 65 Bone". Anything with no such match is reported.
 *
 * @param {string[][]} rows        rows given to the model
 * @param {object[]} categories    validated categories it returned
 * @returns {{expected: number, covered: number, missingRows: string[][], ratio: number}}
 */
function verifyCoverage(rows, categories) {
  const dishRows = (rows || []).filter(isDishRow)
  const returned = Array.from(extractedNames(categories))

  const missingRows = []
  let covered = 0

  for (const row of dishRows) {
    const name = rowName(row)
    if (!name) continue

    const hit = returned.some(
      (candidate) =>
        candidate === name ||
        (candidate.length >= 6 && name.includes(candidate)) ||
        (name.length >= 6 && candidate.includes(name)),
    )

    if (hit) covered += 1
    else missingRows.push(row)
  }

  return {
    expected: dishRows.length,
    covered,
    missingRows,
    ratio: dishRows.length === 0 ? 1 : covered / dishRows.length,
  }
}

/** The missing rows, as text to send back to the model. */
function missingRowsText(missingRows, allRows) {
  // Keep any heading lines: they carry the portion labels the dish rows need.
  const headings = (allRows || []).filter(
    (row) => Array.isArray(row) && row.length > 0 && !isDishRow(row),
  )
  const lines = []
  for (const row of headings.slice(0, 4)) lines.push(row.join('\t'))
  for (const row of missingRows) lines.push(row.join('\t'))
  return lines.join('\n')
}

/**
 * Which of these rows is not represented in the result at all?
 *
 * Unlike verifyCoverage, this does NOT first decide whether a row looks like a
 * dish. That judgement is right for measuring how much of a page came back,
 * and wrong for deciding what to show the admin: rows such as "Slash Suffix
 * 240/-" and "7 Up 60" failed the looks-like-a-dish test and were therefore
 * dropped from the review list entirely - imported nowhere, shown nowhere.
 *
 * A row that reached this point already failed to parse, so the only safe
 * default is to surface it.
 */
function rowsNotRepresented(rows, categories) {
  const returned = Array.from(extractedNames(categories))

  return (rows || []).filter((row) => {
    const name = rowName(row)
    if (!name) return false

    return !returned.some(
      (candidate) =>
        candidate === name ||
        (candidate.length >= 6 && name.includes(candidate)) ||
        (name.length >= 6 && candidate.includes(name)),
    )
  })
}

module.exports = {
  verifyCoverage,
  rowsNotRepresented,
  missingRowsText,
  isDishRow,
  rowName,
  normalise,
}
