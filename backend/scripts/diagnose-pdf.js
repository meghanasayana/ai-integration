#!/usr/bin/env node
'use strict'

/**
 * Finds out why a PDF will not import.
 *
 *   node scripts/diagnose-pdf.js "C:\path\to\menu.pdf"
 *
 * Reads the file only. Touches no database and calls no AI.
 */

const fs = require('fs')
const path = require('path')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/diagnose-pdf.js <file.pdf>')
  process.exit(2)
}

const file = path.resolve(target)
if (!fs.existsSync(file)) {
  console.error(`Not found: ${file}`)
  process.exit(2)
}

const buffer = fs.readFileSync(file)
console.log(`File   : ${path.basename(file)}`)
console.log(`Size   : ${(buffer.length / 1024).toFixed(0)} KB`)

const header = buffer.subarray(0, 8).toString('latin1')
console.log(`Header : ${JSON.stringify(header)}  ${header.startsWith('%PDF-') ? '(valid PDF signature)' : '(NOT a PDF!)'}`)

// /Encrypt in the trailer means the file is password or permissions protected.
const raw = buffer.toString('latin1')
console.log(`Encrypted marker (/Encrypt): ${raw.includes('/Encrypt') ? 'YES - this PDF is protected' : 'no'}`)
console.log(`Font objects (/Font)       : ${(raw.match(/\/Font/g) || []).length}`)
console.log(`Image objects (/Image)     : ${(raw.match(/\/Image/g) || []).length}`)

// pdf-parse v1 exports a function; v2 exports { pdf }. Support both.
let parse
try {
  const mod = require('pdf-parse')
  if (typeof mod === 'function') parse = mod
  else if (mod && typeof mod.pdf === 'function') parse = mod.pdf
  else if (mod && typeof mod.default === 'function') parse = mod.default
  else if (mod && typeof mod.PDFParse === 'function') {
    // v2.4+: class API. destroy() frees pdfjs memory and must run.
    parse = async (buf) => {
      const parser = new mod.PDFParse({ data: buf })
      try {
        return await parser.getText()
      } finally {
        if (typeof parser.destroy === 'function') await parser.destroy()
      }
    }
  }
  else {
    console.error('\npdf-parse exposes no usable function. Exports:',
      mod && typeof mod === 'object' ? Object.keys(mod).join(', ') : typeof mod)
    process.exit(1)
  }
} catch (err) {
  console.error('\npdf-parse could not be loaded:', err.message)
  process.exit(1)
}

Promise.resolve(parse(buffer))
  .then((result) => {
    const text = (result.text || '').trim()
    console.log(`\nParsed OK`)
    console.log(`Pages  : ${result.numpages ?? result.total ?? '?'}`)
    console.log(`Text   : ${text.length} characters`)
    if (text.length < 120) {
      console.log('\nVERDICT: almost no selectable text. This is a scanned/image PDF.')
      console.log('         Export it as an image, or use a PDF created from a document.')
    } else {
      console.log('\nVERDICT: has a text layer. This PDF SHOULD import.')
      console.log('\n--- first 600 characters ---')
      console.log(text.slice(0, 600))
    }
  })
  .catch((err) => {
    console.log(`\nParsed FAILED`)
    console.log(`Reason : ${err.message}`)
    if (/password|encrypt/i.test(err.message)) {
      console.log('\nVERDICT: the PDF is password or permission protected.')
      console.log('         Open it, print to PDF without protection, and try that file.')
    } else {
      console.log('\nVERDICT: pdf-parse cannot read this file. Paste the reason above to Claude.')
    }
  })
