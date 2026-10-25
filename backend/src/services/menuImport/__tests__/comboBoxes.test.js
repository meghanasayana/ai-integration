const test = require('node:test')
const assert = require('node:assert')

const { rowsWithPosition, columnsFromTitles, columnOf, boxesFromItems } = require('../comboBoxes')
const { isComboTitle } = require('../comboBlocks')

/** A page of text items, as pdfjs hands them over: y grows upwards. */
const item = (text, x, y, height = 10) => ({ text, x, y, height, width: text.length * 5 })

test('cells keep their horizontal position', () => {
  const rows = rowsWithPosition([item('Combo - 1', 50, 700), item('Combo - 2', 320, 700)])
  assert.strictEqual(rows.length, 1)
  assert.deepStrictEqual(rows[0].cells.map((c) => c.text), ['Combo - 1', 'Combo - 2'])
  assert.strictEqual(rows[0].cells[0].x, 50)
  assert.strictEqual(rows[0].cells[1].x, 320)
})

test('titles sharing a left edge are one column', () => {
  const centres = columnsFromTitles(
    [{ x: 50 }, { x: 52 }, { x: 320 }, { x: 318 }],
    613,
  )
  assert.strictEqual(centres.length, 2)
  assert.ok(centres[0] < 100 && centres[1] > 300)
})

test('an x is assigned to the nearest column', () => {
  assert.strictEqual(columnOf(60, [51, 319]), 0)
  assert.strictEqual(columnOf(300, [51, 319]), 1)
})

test('two boxes side by side do not swallow each other', () => {
  const boxes = boxesFromItems([
    item('Combo - 1', 50, 700), item('Combo - 2', 320, 700),
    item('Chicken 65', 50, 680), item('Rytha', 320, 680),
    item('Fresh Lime Juice 310/-', 50, 660), item('Gravy 390/-', 320, 660),
  ], 613, isComboTitle)

  assert.strictEqual(boxes.length, 2)
  assert.deepStrictEqual(boxes[0].lines, ['Chicken 65', 'Fresh Lime Juice 310/-'])
  assert.deepStrictEqual(boxes[1].lines, ['Rytha', 'Gravy 390/-'])
})

test('a box claims only what sits below it in its own column', () => {
  const boxes = boxesFromItems([
    item('Combo - 1', 50, 700),
    item('Chicken 65', 50, 680),
    item('Combo - 3', 50, 600),
    item('Chicken Lollypop', 50, 580),
  ], 613, isComboTitle)

  assert.deepStrictEqual(boxes.map((b) => b.lines), [['Chicken 65'], ['Chicken Lollypop']])
})

test('a page heading above the first title is dropped', () => {
  const boxes = boxesFromItems([
    item('Special Combo Taj', 200, 760),
    item('Combo - 1', 50, 700),
    item('Chicken 65', 50, 680),
  ], 613, isComboTitle)

  assert.strictEqual(boxes.length, 1)
  assert.deepStrictEqual(boxes[0].lines, ['Chicken 65'])
})

test('numbered boxes come back in printed order, not page order', () => {
  // Combo 8 sits higher than Combo 7 because the box above it is shorter.
  const boxes = boxesFromItems([
    item('Combo - 8', 320, 400), item('Gobi 65', 320, 380),
    item('Combo - 7', 50, 360), item('Paneer Masala', 50, 340),
  ], 613, isComboTitle)

  assert.deepStrictEqual(boxes.map((b) => b.title), ['Combo - 7', 'Combo - 8'])
})

test('unnumbered boxes fall back to reading down the page', () => {
  const boxes = boxesFromItems([
    item('Thali', 50, 700), item('Rice', 50, 680),
    item('Platter', 50, 600), item('Naan', 50, 580),
  ], 613, isComboTitle)

  assert.deepStrictEqual(boxes.map((b) => b.title), ['Thali', 'Platter'])
})

test('a page with no combo titles yields no boxes', () => {
  const boxes = boxesFromItems([
    item('Non-Veg Starters', 50, 700),
    item('Andhra Chicken - 65', 50, 680), item('230', 250, 680),
  ], 613, isComboTitle)

  assert.deepStrictEqual(boxes, [])
})
