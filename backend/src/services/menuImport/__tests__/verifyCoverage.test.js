'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { verifyCoverage, missingRowsText, isDishRow, rowName } = require('../verifyCoverage')

test('verifyCoverage catches a section the model stopped before reaching', () => {
  // The real failure: page 5 held 30 dish rows in two sections. The model
  // returned the first 17, said it had finished, and reported nothing missing.
  const rows = [['Chicken Main Course']]
  for (let i = 0; i < 17; i += 1) rows.push(['Chicken Dish ' + i, String(200 + i)])
  rows.push(['Mutton Main Course'])
  for (let i = 0; i < 13; i += 1) rows.push(['Mutton Dish ' + i, String(260 + i)])

  const returnedFirstSectionOnly = [{
    name: 'Chicken Main Course',
    items: Array.from({ length: 17 }, (_, i) => ({ name: 'Chicken Dish ' + i, price: String(200 + i) })),
  }]

  const coverage = verifyCoverage(rows, returnedFirstSectionOnly)

  assert.equal(coverage.expected, 30)
  assert.equal(coverage.covered, 17)
  assert.equal(coverage.missingRows.length, 13)
  assert.ok(coverage.ratio < 0.95, 'must fall below the retry threshold')
  assert.equal(coverage.missingRows[0][0], 'Mutton Dish 0')
})

test('verifyCoverage reports full coverage when every row comes back', () => {
  const rows = [['Soup'], ['Veg Soup', '90'], ['Corn Soup', '95']]
  const categories = [{
    name: 'Soup',
    items: [{ name: 'Veg Soup', price: '90' }, { name: 'Corn Soup', price: '95' }],
  }]

  const coverage = verifyCoverage(rows, categories)
  assert.equal(coverage.expected, 2)
  assert.equal(coverage.ratio, 1)
  assert.deepEqual(coverage.missingRows, [])
})

test('verifyCoverage accepts a tidied name rather than demanding an exact match', () => {
  // The model may legitimately shorten a printed name.
  const rows = [['Chicken 65 Bone (8 Pcs)', '190']]
  const categories = [{ name: 'Starters', items: [{ name: 'Chicken 65 Bone', price: '190' }] }]

  assert.equal(verifyCoverage(rows, categories).missingRows.length, 0)
})

test('verifyCoverage counts a row whose price merged into the name cell', () => {
  // Long names run close to the price column and land in one cell.
  const row = ['Pepper Barbeque Chicken 450 250 160']
  assert.ok(isDishRow(row), 'a merged row is still a dish row')
  assert.equal(rowName(row), 'pepper barbeque chicken')

  const categories = [{
    name: 'Barbeque',
    items: [{ name: 'Pepper Barbeque Chicken', portions: [{ label: 'Full', price: '450' }] }],
  }]
  assert.equal(verifyCoverage(row ? [row] : [], categories).missingRows.length, 0)
})

test('verifyCoverage does not expect headings or taglines back as dishes', () => {
  const rows = [
    ['MENU'],
    ['A Royal Journey of Authentic Flavours'],
    ['Full', 'Half', 'Quarter'],
    ['Tandoori Chicken', '440', '240', '150'],
  ]
  const categories = [{
    name: 'Tandoori',
    items: [{ name: 'Tandoori Chicken', portions: [
      { label: 'Full', price: '440' }, { label: 'Half', price: '240' }, { label: 'Quarter', price: '150' },
    ] }],
  }]

  const coverage = verifyCoverage(rows, categories)
  assert.equal(coverage.expected, 1, 'only the dish row is expected back')
  assert.equal(coverage.ratio, 1)
})

test('missingRowsText keeps heading lines so portion labels survive the retry', () => {
  const allRows = [
    ['Grill Chicken'],
    ['Full', 'Half', 'Quarter'],
    ['Pepper Grill', '420', '230', '150'],
    ['Mexican Grill', '420', '230', '150'],
  ]
  const missing = [['Mexican Grill', '420', '230', '150']]

  const text = missingRowsText(missing, allRows)
  assert.ok(text.includes('Full\tHalf\tQuarter'), 'portion labels must be re-sent')
  assert.ok(text.includes('Mexican Grill'))
  assert.ok(!text.includes('Pepper Grill'), 'rows already returned are not re-sent')
})
