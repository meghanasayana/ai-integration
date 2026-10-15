'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { wordsToItems, collectWords, MIN_WORD_CONFIDENCE } = require('../imageOcr')
const { groupIntoRows } = require('../pdfLayout')
const { parseRows } = require('../parseRows')

/** An OCR word as tesseract.js reports one. */
function word(text, x0, y0, x1, y1, confidence = 90) {
  return { text, confidence, bbox: { x0, y0, x1, y1 } }
}

/** The nested shape tesseract.js actually returns. */
function page(words, confidence = 88) {
  return { confidence, blocks: [{ paragraphs: [{ lines: [{ words }] }] }] }
}

test('collectWords flattens the nested OCR result', () => {
  const result = collectWords({
    blocks: [
      { paragraphs: [{ lines: [{ words: [word('Chicken', 0, 0, 80, 20)] }] }] },
      { paragraphs: [{ lines: [{ words: [word('160', 300, 0, 340, 20)] }] }] },
    ],
  })

  assert.deepEqual(result.map((w) => w.text), ['Chicken', '160'])
})

test('collectWords drops blanks and low-confidence noise', () => {
  const result = collectWords(page([
    word('Biryani', 0, 0, 80, 20, 95),
    word('   ', 90, 0, 100, 20, 95),
    word('rn1sread', 110, 0, 180, 20, MIN_WORD_CONFIDENCE - 10),
  ]))

  assert.deepEqual(result.map((w) => w.text), ['Biryani'])
})

test('collectWords survives a result with no blocks', () => {
  // blocks is null unless the caller asks for it, so this must not throw.
  assert.deepEqual(collectWords({ blocks: null }), [])
  assert.deepEqual(collectWords({}), [])
  assert.deepEqual(collectWords(null), [])
})

test('image y is flipped so rows read top to bottom', () => {
  // An image counts y downwards from the top; a PDF counts it upwards. Without
  // flipping, the menu comes out upside down.
  const items = wordsToItems([
    word('Top', 60, 100, 120, 130),
    word('Bottom', 60, 400, 140, 430),
  ])

  const top = items.find((i) => i.text === 'Top')
  const bottom = items.find((i) => i.text === 'Bottom')
  assert.ok(top.y > bottom.y, 'the word nearer the top of the image must sort first')
})

test('a photographed menu reconstructs into dish and price rows', () => {
  // The whole point: OCR words go through the same grouping as a PDF.
  const items = wordsToItems([
    word('Chicken', 60, 100, 170, 130), word('Dum', 175, 100, 230, 130),
    word('Biryani', 235, 100, 330, 130), word('160', 700, 100, 760, 130),
    word('Mutton', 60, 150, 160, 180), word('Dum', 165, 150, 220, 180),
    word('Biryani', 225, 150, 320, 180), word('260', 700, 150, 760, 180),
  ])

  const rows = groupIntoRows(items)
  assert.deepEqual(rows, [
    ['Chicken Dum Biryani', '160'],
    ['Mutton Dum Biryani', '260'],
  ])

  const parsed = parseRows(rows)
  assert.equal(parsed.stats.dishes, 2)
  assert.equal(parsed.categories[0].items[0].price, '160')
})

test('portion columns from a photo keep their labels', () => {
  const items = wordsToItems([
    word('Quarter', 440, 300, 540, 325), word('Half', 600, 300, 660, 325),
    word('Full', 740, 300, 790, 325),
    word('Pepper', 60, 360, 150, 390), word('Grill', 155, 360, 215, 390),
    word('150', 450, 360, 500, 390), word('230', 600, 360, 650, 390),
    word('420', 745, 360, 795, 390),
  ])

  const parsed = parseRows(groupIntoRows(items))
  const dish = parsed.categories[0].items.find((i) => i.name === 'Pepper Grill')

  assert.deepEqual(dish.portions, [
    { label: 'Quarter', price: '150' },
    { label: 'Half', price: '230' },
    { label: 'Full', price: '420' },
  ])
})

test('wordsToItems ignores a word with no bounding box', () => {
  const items = wordsToItems([{ text: 'Orphan', confidence: 90 }, word('Ok', 0, 0, 20, 10)])
  assert.equal(items.length, 1)
  assert.equal(items[0].text, 'Ok')
})

test('wordsToItems survives junk input', () => {
  for (const junk of [null, undefined, [], [null], [{}]]) {
    assert.ok(Array.isArray(wordsToItems(junk)))
  }
})
