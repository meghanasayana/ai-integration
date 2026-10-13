#!/usr/bin/env node
'use strict'

/**
 * Try the menu extractor against a real file, from the command line.
 *
 *   node scripts/menu-ai-test.js path/to/menu.jpg
 *   node scripts/menu-ai-test.js path/to/menu.pdf --raw
 *
 * Touches no database and needs no login. It talks only to your local
 * Ollama, so it is the fastest way to see what the model actually returns
 * for your menus.
 */

const fs = require('fs')
const path = require('path')

const { extractMenuPlan } = require('../src/services/menuImport')
const { DEFAULT_MODEL, DEFAULT_HOST } = require('../src/services/menuImport/ollama')

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

async function main() {
  const args = process.argv.slice(2)
  const showRaw = args.includes('--raw')
  const target = args.find((a) => !a.startsWith('--'))

  if (!target) {
    console.error('Usage: node scripts/menu-ai-test.js <menu-file> [--raw]')
    process.exit(2)
  }

  const filePath = path.resolve(target)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(2)
  }

  const extension = path.extname(filePath).toLowerCase()
  const mimetype = MIME_BY_EXTENSION[extension]
  if (!mimetype) {
    console.error(`Unsupported extension "${extension}". Use jpg, jpeg, png, webp or pdf.`)
    process.exit(2)
  }

  const buffer = fs.readFileSync(filePath)

  console.log(`File   : ${path.basename(filePath)} (${(buffer.length / 1024).toFixed(0)} KB)`)
  console.log(`Model  : ${DEFAULT_MODEL}`)
  console.log(`Ollama : ${DEFAULT_HOST}`)
  console.log('\nReading the menu. A first run can take a few minutes while the model loads.\n')

  const result = await extractMenuPlan({
    buffer,
    mimetype,
    size: buffer.length,
    originalname: path.basename(filePath),
  })

  if (!result.ok) {
    console.error(`FAILED [${result.code}]`)
    console.error(result.message)
    if (result.details) console.error('\nDetails:', result.details)
    if (result.rawPreview) console.error('\nModel returned:\n', result.rawPreview)
    if (result.internal) console.error('\nInternal:', result.internal)
    process.exit(1)
  }

  const { plan, meta } = result
  console.log(`Read in ${(meta.durationMs / 1000).toFixed(1)}s\n`)

  for (const categoryName of plan.summary.categories) {
    console.log(`\n${categoryName.toUpperCase()}`)
    console.log('-'.repeat(categoryName.length))
    for (const entry of plan.entries.filter((e) => e.categoryName === categoryName)) {
      const marker = entry.status === 'ready' ? ' ' : '!'
      const prices = entry.portions.length
        ? entry.portions.map((p) => `${p.portion} ${p.price}`).join('   ')
        : entry.price === null
          ? '(no price)'
          : String(entry.price)
      console.log(`${marker} ${entry.name.padEnd(34)} ${prices}`)
      for (const warning of entry.warnings) {
        console.log(`    ${warning.blocking ? 'BLOCKING' : 'note'}: ${warning.message}`)
      }
    }
  }

  console.log(
    `\n${plan.summary.total} dishes - ${plan.summary.ready} ready, ${plan.summary.review} need review`,
  )

  if (showRaw) {
    console.log('\n--- full plan JSON ---')
    console.log(JSON.stringify(plan, null, 2))
  }
}

main().catch((err) => {
  console.error('Unexpected failure:', err)
  process.exit(1)
})
