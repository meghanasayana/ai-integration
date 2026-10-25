const test = require('node:test')
const assert = require('node:assert')

const { sanitiseLines, sanitiseCombo, lineToText } = require('../validate')

test('a plain string with slashes becomes a choice', () => {
  const [line] = sanitiseLines(['Chicken Biriyani / Mugual Biriyani / Chicken 65 Biriyani'])
  assert.deepStrictEqual(line.options, [
    'Chicken Biriyani',
    'Mugual Biriyani',
    'Chicken 65 Biriyani',
  ])
  assert.strictEqual(line.note, null)
  assert.strictEqual(line.sortOrder, 0)
})

test('a plain string with no slash is a fixed inclusion', () => {
  const [line] = sanitiseLines(['Fresh Lime Juice'])
  assert.deepStrictEqual(line.options, ['Fresh Lime Juice'])
})

test('an object line keeps its note', () => {
  const [line] = sanitiseLines([{ options: ['Naan', 'Rotti'], note: '2 pcs' }])
  assert.deepStrictEqual(line.options, ['Naan', 'Rotti'])
  assert.strictEqual(line.note, '2 pcs')
})

test('sortOrder follows the order given', () => {
  const lines = sanitiseLines(['A', 'B', 'C'])
  assert.deepStrictEqual(lines.map((l) => l.sortOrder), [0, 1, 2])
})

test('blank options are dropped, not kept as empty strings', () => {
  const [line] = sanitiseLines(['Chicken Fried Rice / / Noodles /'])
  assert.deepStrictEqual(line.options, ['Chicken Fried Rice', 'Noodles'])
})

test('the same option twice on one line is collapsed', () => {
  const [line] = sanitiseLines([{ options: ['Naan', 'naan', 'Rotti'] }])
  assert.deepStrictEqual(line.options, ['Naan', 'Rotti'])
})

test('a line with nothing in it is rejected', () => {
  assert.throws(() => sanitiseLines(['   /  / ']), /needs at least one option/)
})

test('a combo with no lines is rejected', () => {
  assert.throws(() => sanitiseLines([]), /at least one line/)
})

test('lines must be an array', () => {
  assert.throws(() => sanitiseLines('Fresh Lime Juice'), /must be an array/)
  assert.throws(() => sanitiseLines(undefined), /must be an array/)
})

test('too many lines is rejected', () => {
  const many = Array.from({ length: 13 }, (_, i) => `Item ${i}`)
  assert.throws(() => sanitiseLines(many), /more than 12 lines/)
})

test('the error names which line was wrong', () => {
  assert.throws(() => sanitiseLines(['Fine', 'Also fine', { note: 'no options' }]), /line 3/)
})

test('a combo needs a name', () => {
  assert.throws(() => sanitiseCombo({ price: 310 }), /name is required/)
  assert.throws(() => sanitiseCombo({ name: '   ', price: 310 }), /name is required/)
})

test('price arrives from a form as a string and is still a number', () => {
  const combo = sanitiseCombo({ name: 'Combo - 1', price: '310' })
  assert.strictEqual(combo.price, 310)
})

test('a price that is not a number is rejected', () => {
  assert.throws(() => sanitiseCombo({ name: 'Combo - 1', price: 'three ten' }), /must be a number/)
})

test('a negative price is rejected', () => {
  assert.throws(() => sanitiseCombo({ name: 'Combo - 1', price: -5 }), /cannot be negative/)
})

test('a free combo is allowed', () => {
  assert.strictEqual(sanitiseCombo({ name: 'Tasting', price: 0 }).price, 0)
})

test('isVeg defaults to false and only a real true sets it', () => {
  assert.strictEqual(sanitiseCombo({ name: 'C', price: 1 }).isVeg, false)
  assert.strictEqual(sanitiseCombo({ name: 'C', price: 1, isVeg: 'true' }).isVeg, false)
  assert.strictEqual(sanitiseCombo({ name: 'C', price: 1, isVeg: true }).isVeg, true)
})

test('isAvailable defaults to true and only a real false clears it', () => {
  assert.strictEqual(sanitiseCombo({ name: 'C', price: 1 }).isAvailable, true)
  assert.strictEqual(sanitiseCombo({ name: 'C', price: 1, isAvailable: false }).isAvailable, false)
})

test('a line reads the way it will be printed on the card', () => {
  assert.strictEqual(
    lineToText({ options: ['Naan', 'Rotti'], note: '2 pcs' }),
    'Naan or Rotti (2 pcs)',
  )
  assert.strictEqual(lineToText({ options: ['Gravy'], note: null }), 'Gravy')
})

test('Combo - 1 from the Taj menu survives the round trip', () => {
  const lines = sanitiseLines([
    'Chicken Biriyani / Mugual Biriyani / Chicken 65 Biriyani',
    'Chicken 65',
    'Rytha',
    'Gravy',
    'Fresh Lime Juice',
  ])
  assert.strictEqual(lines.length, 5)
  assert.strictEqual(lines[0].options.length, 3)
  assert.deepStrictEqual(lines.slice(1).map((l) => l.options[0]), [
    'Chicken 65', 'Rytha', 'Gravy', 'Fresh Lime Juice',
  ])
})
