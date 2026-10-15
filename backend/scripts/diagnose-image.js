'use strict'

/**
 * Show exactly what OCR read from an image, and what the parser made of it.
 *
 * Read-only: no database, no saving. It prints the rows so a wrong import can
 * be traced to the row that caused it instead of guessed at.
 *
 *   node scripts/diagnose-image.js "test-menu.png"
 */

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { extractImageRows } = require('../src/services/menuImport/imageOcr')
const { parseRows } = require('../src/services/menuImport/parseRows')

async function main() {
  const input = process.argv[2]
  if (!input) {
    console.error('Usage: node scripts/diagnose-image.js "<image>"')
    process.exit(1)
  }

  const candidates = [
    path.resolve(input),
    path.resolve(process.cwd(), input),
    path.resolve(process.cwd(), 'test-fixtures', input),
    path.resolve(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', input),
  ]
  const file = candidates.find((p) => fs.existsSync(p))

  if (!file) {
    console.error('Not found. Looked in:')
    for (const c of candidates) console.error('  ' + c)
    process.exit(1)
  }

  console.log('File: ' + path.basename(file))
  console.log('Reading with OCR, first run downloads language data...\n')

  const started = Date.now()
  const ocr = await extractImageRows(fs.readFileSync(file))
  console.log('Read in ' + ((Date.now() - started) / 1000).toFixed(1) + 's')
  console.log('Words: ' + ocr.words +
    '   confidence: ' + (ocr.confidence === null ? '?' : Math.round(ocr.confidence)))

  console.log('\n--------- ROWS AS THE PARSER SEES THEM ---------')
  ocr.rows.forEach((row, i) => {
    console.log(String(i).padStart(3) + ' | ' + row.map((c) => JSON.stringify(c)).join('  ,  '))
  })

  const parsed = parseRows(ocr.rows)
  console.log('\n--------- PARSED ---------')
  console.log('dishes ' + parsed.stats.dishes +
    ' | categories ' + parsed.stats.categories +
    ' | needs review ' + parsed.stats.ambiguous +
    ' | unreadable ' + parsed.stats.unparsed)

  for (const category of parsed.categories) {
    console.log('\n[' + category.name + ']')
    for (const item of category.items) {
      const price = item.portions
        ? item.portions.map((p) => p.label + ' ' + p.price).join(', ')
        : item.price
      console.log('   ' + item.name + '  ->  ' + price)
    }
  }

  if (parsed.unparsed.length > 0) {
    console.log('\n--------- ROWS THE PARSER COULD NOT READ ---------')
    for (const row of parsed.unparsed) console.log('   ' + JSON.stringify(row))
  }

  console.log('\nNOTE: nothing was saved. This script never writes to the database.')
}

main().catch((error) => {
  console.error('\nFAILED: ' + (error.code || '') + ' ' + error.message)
  process.exit(1)
})
