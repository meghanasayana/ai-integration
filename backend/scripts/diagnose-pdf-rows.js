'use strict'

/**
 * Show what the PDF looks like after position-based row reconstruction.
 *
 * Read-only: opens the file, prints what it found, touches no database and
 * calls no AI. Safe to run as often as you like.
 *
 *   node scripts/diagnose-pdf-rows.js "Kareem Nawab.pdf"
 *   node scripts/diagnose-pdf-rows.js "Kareem Nawab.pdf" 3     (page 3)
 */

const fs = require('fs')
const path = require('path')
const { extractRows, rowsToText, pairingScore } = require('../src/services/menuImport/pdfLayout')

async function main () {
  const input = process.argv[2]
  const wantedPage = process.argv[3] ? Number(process.argv[3]) : 1

  if (!input) {
    console.error('Usage: node scripts/diagnose-pdf-rows.js "<file.pdf>" [pageNumber]')
    process.exit(1)
  }

  const candidates = [
    path.resolve(input),
    path.resolve(process.cwd(), input),
    path.resolve(process.cwd(), '..', input),
    path.resolve(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', input),
  ]
  const file = candidates.find((p) => fs.existsSync(p))

  if (!file) {
    console.error('Not found. Looked in:')
    for (const c of candidates) console.error('  ' + c)
    process.exit(1)
  }

  const buffer = fs.readFileSync(file)
  console.log('File  : ' + path.basename(file))
  console.log('Size  : ' + Math.round(buffer.length / 1024) + ' KB')
  console.log('')

  const result = await extractRows(buffer, { maxPages: 20 })
  console.log('Pages in file : ' + result.pageCount)
  console.log('Pages read    : ' + result.pagesRead)

  const score = pairingScore(result.pages)
  console.log('')
  console.log('Rows found           : ' + score.rows)
  console.log('Rows "name + number" : ' + score.paired + '  (' + Math.round(score.ratio * 100) + '%)')
  console.log('')

  if (score.ratio >= 0.4) {
    console.log('VERDICT: rows reconstructed. Dish names and prices are on the same line.')
  } else if (score.rows === 0) {
    console.log('VERDICT: no text found. This PDF is scanned images; it needs the image path.')
  } else {
    console.log('VERDICT: rows found but few pair a name with a number. Check the sample below')
    console.log('         before trusting an import from this file.')
  }

  const page = result.pages.find((p) => p.num === wantedPage) || result.pages[0]
  if (page) {
    console.log('')
    console.log('--------- page ' + page.num + ', first 40 rows ---------')
    for (const row of page.rows.slice(0, 40)) {
      console.log(row.join('  |  '))
    }
  }

  const asPrompt = rowsToText(result.pages.slice(0, 1))
  console.log('')
  console.log('--------- what the AI would receive (page 1, first 500 chars) ---------')
  console.log(JSON.stringify(asPrompt.slice(0, 500)))
}

main().catch((error) => {
  console.error('')
  console.error('FAILED: ' + error.message)
  process.exit(1)
})
