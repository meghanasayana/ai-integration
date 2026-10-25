const test = require('node:test')
const assert = require('node:assert')

const {
  isComboTitle,
  extractPrice,
  stripPrice,
  joinContinuations,
  parseComboBlock,
  combosFromLines,
  looksLikeComboPage,
} = require('../comboBlocks')

test('combo titles are recognised however they are punctuated', () => {
  for (const title of ['Combo - 1', 'Combo -2', 'COMBO 3', 'combo-4', 'Thali', 'Family Pack - 2']) {
    assert.ok(isComboTitle(title), `should match: ${title}`)
  }
})

test('a dish that merely contains a combo word is not a title', () => {
  for (const line of ['Chicken Combo Biriyani 240', 'Meal Maker Curry', 'Fresh Lime Juice']) {
    assert.ok(!isComboTitle(line), `should not match: ${line}`)
  }
})

test('price is read from the "310/-" form', () => {
  assert.strictEqual(extractPrice(['Fresh Lime Juice 310/-']), 310)
  assert.strictEqual(extractPrice(['Fresh Lime Juice       290', '/-']), 290)
})

test('price is read from the "Rs. 310" form', () => {
  assert.strictEqual(extractPrice(['Chicken 65   Rs. 310']), 310)
})

test('a quantity is never mistaken for the price', () => {
  assert.strictEqual(extractPrice(['Gobi 65 (5 Pcs)', 'Naan / Rotti (2 Pcs)']), null)
  assert.strictEqual(extractPrice(['Chicken 65', 'Rytha']), null)
})

test('the price wins over a quantity in the same box', () => {
  assert.strictEqual(extractPrice(['Gobi 65 (5 Pcs)', 'Fresh Lime Juice 260/-']), 260)
})

test('stripping leaves the item text alone', () => {
  assert.strictEqual(stripPrice('Fresh Lime Juice 310/-'), 'Fresh Lime Juice')
  assert.strictEqual(stripPrice('Chicken 65          Rs.'), 'Chicken 65')
  assert.strictEqual(stripPrice('Gobi 65 (5 Pcs)'), 'Gobi 65 (5 Pcs)')
  assert.strictEqual(stripPrice('Naan / Rotti (2 Pcs)'), 'Naan / Rotti (2 Pcs)')
})

test('a choice broken across lines by a trailing slash is rejoined', () => {
  assert.deepStrictEqual(
    joinContinuations(['Chicken Biriyani/', 'Mugual Biriyani/', 'Chicken 65 Biriyani', 'Chicken 65']),
    ['Chicken Biriyani / Mugual Biriyani / Chicken 65 Biriyani', 'Chicken 65'],
  )
})

test('a leading slash on the next line also continues the choice', () => {
  assert.deepStrictEqual(
    joinContinuations(['Veg/Panner/Mushroom', '/BabyCorn/Gobi Biriyani', 'Gobi 65 (5 Pcs)']),
    ['Veg/Panner/Mushroom / BabyCorn/Gobi Biriyani', 'Gobi 65 (5 Pcs)'],
  )
})

test('Combo - 1 from the Taj menu comes out whole', () => {
  const combo = parseComboBlock('Combo - 1', [
    'Chicken Biriyani/',
    'Mugual Biriyani/',
    'Chicken 65 Biriyani',
    'Chicken 65          Rs.',
    'Rytha Gravy',
    'Fresh Lime Juice 310/-',
  ])

  assert.strictEqual(combo.name, 'Combo - 1')
  assert.strictEqual(combo.price, 310)
  assert.deepStrictEqual(combo.lines, [
    'Chicken Biriyani / Mugual Biriyani / Chicken 65 Biriyani',
    'Chicken 65',
    'Rytha Gravy',
    'Fresh Lime Juice',
  ])
  assert.strictEqual(combo.needsReview, false)
})

test('Combo - 6 keeps its compound slash line exactly as printed', () => {
  const combo = parseComboBlock('Combo - 6', [
    'Veg/Panner/Mushroom',
    '/BabyCorn/Gobi Fried Rice/Noodles',
    'Gobi Manchurian Dry Rs.',
    'Fresh Lime Juice        270/-',
  ])

  assert.strictEqual(combo.price, 270)
  assert.strictEqual(combo.lines[0], 'Veg/Panner/Mushroom / BabyCorn/Gobi Fried Rice/Noodles')
  assert.strictEqual(combo.lines.length, 3)
})

test('a box with no price is flagged, not dropped', () => {
  const combo = parseComboBlock('Combo - 9', ['Chicken 65', 'Fresh Lime Juice'])
  assert.strictEqual(combo.price, null)
  assert.strictEqual(combo.needsReview, true)
  assert.match(combo.reason, /No price/)
})

test('a box with a single item is flagged for a look', () => {
  const combo = parseComboBlock('Combo - 9', ['Fresh Lime Juice 100/-'])
  assert.strictEqual(combo.needsReview, true)
  assert.match(combo.reason, /one item/)
})

test('a page heading above the boxes is not swallowed into a combo', () => {
  const combos = combosFromLines([
    'Special Combo Taj',
    'Combo - 1',
    'Chicken 65',
    'Fresh Lime Juice 310/-',
  ])
  assert.strictEqual(combos.length, 1)
  assert.ok(!combos[0].lines.includes('Special Combo Taj'))
})

test('several boxes on one page are kept apart', () => {
  const combos = combosFromLines([
    'Combo - 1', 'Chicken 65', 'Fresh Lime Juice 310/-',
    'Combo - 2', 'Rytha', 'Fresh Lime Juice 390/-',
  ])
  assert.deepStrictEqual(combos.map((c) => [c.name, c.price]), [['Combo - 1', 310], ['Combo - 2', 390]])
})

test('a page of ordinary dishes is not treated as combos', () => {
  const lines = ['Non-Veg Starters', 'Andhra Chicken - 65   230', 'Chicken Lollypop Dry  230']
  assert.strictEqual(looksLikeComboPage(lines), false)
  assert.strictEqual(combosFromLines(lines).length, 0)
})

test('the Taj combo page is recognised as one', () => {
  assert.strictEqual(
    looksLikeComboPage(['Special Combo Taj', 'Combo - 1', 'Chicken 65', 'Combo - 2']),
    true,
  )
})

/* ---- added after the first real photograph went through OCR ---- */

const { tidyCombos, comboNumber, dropHeadingBoxes } = require('../comboBlocks')

test('a title that lost its number to a line break gets it back', () => {
  // OCR read "Combo - 4" as "Combo" with the 4 pushed onto the next line.
  const combo = parseComboBlock('Combo', ['4', 'Butter Chicken', 'Fresh Lime Juice 290/-'])
  assert.strictEqual(combo.name, 'Combo - 4')
  assert.ok(!combo.lines.includes('4'))
  assert.strictEqual(combo.price, 290)
})

test('a quantity on the first line is not mistaken for the box number', () => {
  const combo = parseComboBlock('Thali', ['Gobi 65 (5 Pcs)', 'Fresh Lime Juice 260/-'])
  assert.strictEqual(combo.name, 'Thali')
  assert.strictEqual(combo.lines[0], 'Gobi 65 (5 Pcs)')
})

test('OCR crumbs are dropped from the lines', () => {
  const combo = parseComboBlock('Combo - 8', ['Gobi 65 (5 Pcs)', '“', '-', 'Fresh Lime Juice 260/-'])
  assert.deepStrictEqual(combo.lines, ['Gobi 65 (5 Pcs)', 'Fresh Lime Juice'])
})

test('the page heading is dropped once the real boxes are numbered', () => {
  const kept = dropHeadingBoxes([
    { name: 'Combo', lines: ['Taj'] },
    { name: 'Combo - 1', lines: ['Chicken 65'] },
    { name: 'Combo - 2', lines: ['Rytha'] },
  ])
  assert.deepStrictEqual(kept.map((c) => c.name), ['Combo - 1', 'Combo - 2'])
})

test('a menu that numbers nothing keeps every box', () => {
  const kept = dropHeadingBoxes([
    { name: 'Thali', lines: ['Rice'] },
    { name: 'Platter', lines: ['Naan'] },
  ])
  assert.strictEqual(kept.length, 2)
})

test('comboNumber reads the trailing number only', () => {
  assert.strictEqual(comboNumber('Combo - 7'), 7)
  assert.strictEqual(comboNumber('Combo'), null)
  assert.strictEqual(comboNumber('Thali'), null)
})

test('tidying puts a page of boxes into printed order', () => {
  const tidied = tidyCombos([
    { name: 'Combo', lines: ['Taj'] },
    { name: 'Combo - 8', lines: ['Gobi 65'] },
    { name: 'Combo - 7', lines: ['Paneer Masala'] },
    { name: 'Combo - 1', lines: ['Chicken 65'] },
  ])
  assert.deepStrictEqual(tidied.map((c) => c.name), ['Combo - 1', 'Combo - 7', 'Combo - 8'])
})
