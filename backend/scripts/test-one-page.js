'use strict'

/**
 * Ask the model to read ONE page of the menu.
 *
 * Deliberately isolated: no database, no login, no website, no Docker. It
 * touches only the one thing that has never been proven on this machine -
 * whether the local model returns usable menu JSON.
 *
 *   node scripts/test-one-page.js          (page 5, the simplest page)
 *   node scripts/test-one-page.js 2        (page 2, multi-portion columns)
 */

// Load .env FIRST. Without this the script ignored OLLAMA_TIMEOUT_MS and used
// the 3-minute default, so a model that was still working looked like a
// failure. Any script that calls the model must do this before requiring it.
require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { extractPdfContent } = require('../src/services/menuImport/pdfText')
const { extractFromRows } = require('../src/services/menuImport/ollama')
const { validateAiOutput } = require('../src/services/menuImport/validateAiOutput')
const { buildImportPlan } = require('../src/services/menuImport/buildImportPlan')

const FIXTURE = path.join(__dirname, '..', 'test-fixtures', 'Kareem Nawab.pdf')

async function main () {
  const wanted = Number(process.argv[2] || 5)
  const model = process.argv[3] || process.env.OLLAMA_TEXT_MODEL || undefined

  if (!fs.existsSync(FIXTURE)) {
    console.error('Fixture missing: ' + FIXTURE)
    process.exit(1)
  }

  const content = await extractPdfContent(fs.readFileSync(FIXTURE))
  const page = content.pagesText.find((p) => p.num === wanted)

  if (!page) {
    console.error('No page ' + wanted + '. Pages with dishes: ' +
      content.pagesText.map((p) => p.num).join(', '))
    process.exit(1)
  }

  console.log('Page ' + page.num + ', ' + page.pairing.paired + ' paired rows')
  console.log('What the model is given (first 8 rows):')
  for (const line of page.text.split('\n').slice(0, 8)) {
    console.log('   ' + line.replace(/\t/g, '  ->  '))
  }

  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 180000)
  console.log('\nModel   : ' + (model || 'default (vision model)'))
  console.log('Giving up after: ' + Math.round(timeoutMs / 1000) + 's')
  console.log('')

  const startedAt = Date.now()
  // A heartbeat, so silence is distinguishable from a hang.
  const ticker = setInterval(() => {
    process.stdout.write('  still working, ' +
      Math.round((Date.now() - startedAt) / 1000) + 's elapsed\n')
  }, 15000)

  let aiResult
  try {
    aiResult = await extractFromRows({ rowsText: page.text, model })
  } catch (error) {
    clearInterval(ticker)
    const waited = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.error('MODEL FAILED after ' + waited + 's: ' + (error.code || '') + ' ' + error.message)
    process.exit(1)
  }
  clearInterval(ticker)

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log('Replied in ' + seconds + 's, ' + String(aiResult.raw || '').length + ' characters\n')

  const validated = validateAiOutput(aiResult.raw)

  if (!validated.ok) {
    console.log('REPLY NOT USABLE. Problems:')
    for (const err of validated.errors.slice(0, 5)) console.log('  - ' + err)
    console.log('\nFirst 400 characters of what came back:')
    console.log(String(aiResult.raw).slice(0, 400))
    process.exit(1)
  }

  const plan = buildImportPlan(validated.categories)
  console.log('USABLE. Categories: ' +
    validated.categories.map((c) => c.name + ' (' + c.items.length + ')').join(', '))
  console.log('Ready to import: ' + plan.summary.ready + '   Needs review: ' + plan.summary.review)
  console.log('\nFirst 12 entries:')

  for (const entry of plan.entries.slice(0, 12)) {
    const price = entry.portions && entry.portions.length > 0
      ? entry.portions.map((p) => p.label + ' ' + p.price).join(', ')
      : entry.price
    console.log('  [' + entry.status + '] ' + entry.name + '  ->  ' + price +
      (entry.warnings && entry.warnings.length ? '   (' + entry.warnings.join('; ') + ')' : ''))
  }

  console.log('\nNOTE: nothing was saved. This script never writes to the database.')
}

main().catch((error) => {
  console.error('\nFAILED: ' + error.message)
  process.exit(1)
})
