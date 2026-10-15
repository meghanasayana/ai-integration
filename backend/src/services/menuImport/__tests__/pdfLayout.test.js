'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  groupIntoRows,
  splitIntoBlocks,
  interleaveScore,
} = require('../pdfLayout')
const { mergeCategories } = require('../mergePages')

/** A text item as pdfjs reports one. */
function item(text, x, y, width) {
  return { text, x, y, height: 11, width: width != null ? width : text.length * 5 }
}

test('groupIntoRows pairs a dish with its price when the PDF drew columns separately', () => {
  // The failure this module exists to fix: the whole name column is drawn
  // first, then the whole price column, so storage order loses the pairing.
  const items = [
    item('Arabian Mandi', 60, 700),
    item('Mutton Mandi', 60, 678),
    item('Chicken Mandi', 60, 656),
    item('160', 500, 700, 18),
    item('260', 500, 678, 18),
    item('250', 500, 656, 18),
  ]

  assert.deepEqual(groupIntoRows(items), [
    ['Arabian Mandi', '160'],
    ['Mutton Mandi', '260'],
    ['Chicken Mandi', '250'],
  ])
})

test('groupIntoRows keeps a multi-portion row in column order', () => {
  const items = [
    item('Quarter', 330, 700, 40), item('Half', 420, 700, 25), item('Full', 510, 700, 22),
    item('Tandoori Chicken', 60, 678),
    item('110', 330, 678, 18), item('210', 420, 678, 18), item('400', 510, 678, 18),
  ]

  const rows = groupIntoRows(items)
  assert.deepEqual(rows[0], ['Quarter', 'Half', 'Full'])
  assert.deepEqual(rows[1], ['Tandoori Chicken', '110', '210', '400'])
})

test('groupIntoRows joins words of one name instead of splitting them into cells', () => {
  const items = [item('Pepper', 60, 700, 32), item('Grill', 94, 700, 24), item('420', 500, 700, 18)]
  assert.deepEqual(groupIntoRows(items), [['Pepper Grill', '420']])
})

test('splitIntoBlocks separates two sections printed side by side', () => {
  // Left: Soup. Right: Grill. Same baselines, so grouping by y alone would
  // merge one line of each into a single nonsense row.
  const items = [
    item('Veg Soup', 40, 700, 50), item('90', 180, 700, 18),
    item('Hot Soup', 40, 678, 50), item('100', 180, 678, 18),
    item('Veg Clear', 40, 656, 50), item('95', 180, 656, 18),
    item('Corn Soup', 40, 634, 50), item('90', 180, 634, 18),
    item('Mix Soup', 40, 612, 50), item('99', 180, 612, 18),
    item('Grill Chicken', 330, 700, 70), item('400', 500, 700, 18),
    item('Pepper Grill', 330, 678, 70), item('420', 500, 678, 18),
    item('Peri Grill', 330, 656, 70), item('430', 500, 656, 18),
    item('Mexican Grill', 330, 634, 70), item('440', 500, 634, 18),
    item('Schezwan Grill', 330, 612, 70), item('450', 500, 612, 18),
  ]

  const merged = groupIntoRows(items)
  assert.ok(interleaveScore(merged) > 0, 'without splitting, rows should interleave')

  const blocks = splitIntoBlocks(items, 595)
  assert.equal(blocks.length, 2)

  const rows = blocks.flatMap((block) => groupIntoRows(block))
  assert.equal(interleaveScore(rows), 0, 'after splitting, no row holds two dish names')
  assert.deepEqual(rows[0], ['Veg Soup', '90'])
  assert.ok(rows.some((r) => r[0] === 'Grill Chicken' && r[1] === '400'))
})

test('splitIntoBlocks refuses to split names away from their prices', () => {
  // The gap between a dish name and its price is also vertical whitespace.
  // Splitting there would put every name in one block and every price in
  // another, recreating the original bug, so the guard must reject it.
  const items = []
  for (let i = 0; i < 8; i += 1) {
    items.push(item('Dish Number ' + i, 60, 700 - i * 22, 70))
    items.push(item(String(100 + i), 500, 700 - i * 22, 18))
  }

  const blocks = splitIntoBlocks(items, 595)
  const rows = blocks.flatMap((block) => groupIntoRows(block))

  assert.ok(
    rows.every((row) => row.length === 2),
    'every row must still carry both a name and a price',
  )
})

test('mergeCategories combines a section that spans two pages', () => {
  const merged = mergeCategories([
    [{ name: 'Biryani', items: [{ name: 'Chicken Dum', price: '160' }] }],
    [{ name: 'biryani', items: [{ name: 'Mutton Dum', price: '260' }] }],
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].name, 'Biryani', 'keeps the first spelling seen')
  assert.deepEqual(merged[0].items.map((i) => i.name), ['Chicken Dum', 'Mutton Dum'])
})

test('mergeCategories drops an exact repeat but keeps a conflicting price', () => {
  const merged = mergeCategories([
    [{ name: 'Starters', items: [{ name: 'Chicken 65', price: '190' }] }],
    [{ name: 'Starters', items: [
      { name: 'Chicken 65', price: '190' },   // same dish repeated: drop
      { name: 'Chicken 65', price: '220' },   // different price: keep for review
    ] }],
  ])

  assert.equal(merged[0].items.length, 2)
  assert.deepEqual(merged[0].items.map((i) => i.price), ['190', '220'])
})

test('mergeCategories keeps category order and ignores malformed pages', () => {
  const merged = mergeCategories([
    [{ name: 'Soup', items: [{ name: 'Veg Soup', price: '90' }] }],
    null,
    [{ name: 'Mandi', items: [{ name: 'Fish Mandi', price: '400' }] }],
    [{ name: 'Soup', items: [{ name: 'Corn Soup', price: '95' }] }],
  ])

  assert.deepEqual(merged.map((c) => c.name), ['Soup', 'Mandi'])
  assert.equal(merged[0].items.length, 2)
})

test('a wide name-to-price gap is not mistaken for two sections', () => {
  // A single-column menu with right-aligned prices has a wide empty middle,
  // which looks exactly like the gutter between side-by-side sections.
  // Splitting there separated every name from every price, and only dishes
  // with a number inside the name survived - "Chicken 65" priced 65.
  const items = [
    item('Chicken 65', 45, 700, 70), item('190', 690, 700, 28),
    item('Dragon Chicken', 45, 670, 95), item('220', 690, 670, 28),
    item('Chicken Manchurian', 45, 640, 120), item('190', 690, 640, 28),
    item('Paneer 65', 45, 610, 62), item('170', 690, 610, 28),
    item('Veg Manchurian', 45, 580, 95), item('160', 690, 580, 28),
    item('Gobi 65', 45, 550, 50), item('150', 690, 550, 28),
  ]

  const blocks = splitIntoBlocks(items, 768)
  assert.equal(blocks.length, 1, 'the page must not be split')

  const rows = blocks.flatMap((block) => groupIntoRows(block))
  assert.ok(
    rows.every((row) => row.length === 2),
    'every row must keep its name and its price together: ' + JSON.stringify(rows),
  )
})
