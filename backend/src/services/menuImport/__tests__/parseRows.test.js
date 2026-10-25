'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseRows, splitNameAndPrices, isDecorativeEcho } = require('../parseRows')

/** Find a dish by name across the parsed categories. */
function find(result, name) {
  for (const category of result.categories) {
    const hit = category.items.find((i) => i.name === name)
    if (hit) return { category: category.name, item: hit }
  }
  return null
}

test('reads a heading and the dishes under it', () => {
  const result = parseRows([
    ['Biryani'],
    ['Chicken Dum Biryani', '160'],
    ['Mutton Dum Biryani', '260'],
  ])

  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].name, 'Biryani')
  assert.deepEqual(result.categories[0].items, [
    { name: 'Chicken Dum Biryani', price: '160' },
    { name: 'Mutton Dum Biryani', price: '260' },
  ])
})

test('labels multiple prices from the column headings above them', () => {
  const result = parseRows([
    ['Grill Chicken'],
    ['Quarter', 'Half', 'Full'],
    ['Pepper Grill', '150', '230', '420'],
  ])

  assert.deepEqual(find(result, 'Pepper Grill').item.portions, [
    { label: 'Quarter', price: '150' },
    { label: 'Half', price: '230' },
    { label: 'Full', price: '420' },
  ])
})

test('takes the section name from a heading row that also carries the labels', () => {
  // The real menu prints "Arabian Mandi  Full  Half  Quarter" on one line.
  const result = parseRows([
    ['Arabian Mandi', 'Full', 'Half', 'Quarter'],
    ['Mutton Mandi', '1600', '850', '450'],
  ])

  const hit = find(result, 'Mutton Mandi')
  assert.equal(hit.category, 'Arabian Mandi')
  assert.deepEqual(hit.item.portions, [
    { label: 'Full', price: '1600' },
    { label: 'Half', price: '850' },
    { label: 'Quarter', price: '450' },
  ])
})

test('a dash means that portion is not sold, never a price of zero', () => {
  const result = parseRows([
    ['Arabian Mandi', 'Full', 'Half', 'Quarter'],
    ['Paneer Mandi', '1100', '570', '-'],
  ])

  const portions = find(result, 'Paneer Mandi').item.portions
  assert.equal(portions.length, 2, 'the unsold portion is left out')
  assert.deepEqual(portions, [
    { label: 'Full', price: '1100' },
    { label: 'Half', price: '570' },
  ])
  assert.ok(!portions.some((p) => p.price === '0'), 'never records 0')
})

test('recovers prices that merged into the name cell', () => {
  const merged = splitNameAndPrices('Pepper Barbeque Chicken 450 250 160')
  assert.equal(merged.name, 'Pepper Barbeque Chicken')
  assert.deepEqual(merged.prices, ['450', '250', '160'])

  const one = splitNameAndPrices('Chicken 65 Boneless Dum Biryani 220')
  assert.equal(one.name, 'Chicken 65 Boneless Dum Biryani')
  assert.deepEqual(one.prices, ['220'])

  // A dash belongs in the run and must keep its position, so the prices that
  // follow it do not slide onto the wrong labels.
  const withDash = splitNameAndPrices('Paneer Mandi 1100 570 -')
  assert.equal(withDash.name, 'Paneer Mandi')
  assert.deepEqual(withDash.prices, ['1100', '570'])
  assert.deepEqual(withDash.tokens, [
    { price: '1100' }, { price: '570' }, { unsold: true },
  ])

  const result = parseRows([
    ['Barbeque'],
    ['Full', 'Half', 'Quarter'],
    ['Pepper Barbeque Chicken 450 250 160'],
  ])
  assert.deepEqual(find(result, 'Pepper Barbeque Chicken').item.portions, [
    { label: 'Full', price: '450' },
    { label: 'Half', price: '250' },
    { label: 'Quarter', price: '160' },
  ])
})

test('keeps a dish name that merely contains digits', () => {
  // "Chicken 65" is a name, not a price, and "(8 Pcs)" is part of it.
  const result = parseRows([['Starters'], ['Chicken 65 Bone (8 Pcs)', '190']])
  assert.equal(find(result, 'Chicken 65 Bone (8 Pcs)').item.price, '190')
})

test('splits several prices sharing one cell when the labels agree', () => {
  const result = parseRows([
    ['Grill Chicken'],
    ['Full', 'Half', 'Quarter'],
    ['Grill Chicken', '400 220 140'],
  ])
  assert.deepEqual(find(result, 'Grill Chicken').item.portions, [
    { label: 'Full', price: '400' },
    { label: 'Half', price: '220' },
    { label: 'Quarter', price: '140' },
  ])
})

test('refuses to label prices when no headings say what they mean', () => {
  // "110 / 140" with nothing above it could be anything. It is handed back as
  // printed so the review step flags it, rather than guessed at here.
  const result = parseRows([['Soup'], ['Chicken Soup', '110 / 140']])
  const item = find(result, 'Chicken Soup').item

  assert.equal(item.price, '110 / 140')
  assert.equal(item.portions, undefined)
  assert.equal(result.stats.ambiguous, 1)
})

test('ignores the decorative heading printed sideways down the page', () => {
  assert.equal(isDecorativeEcho('BIRYANI', 'Clay Pot Biryani'), true)
  assert.equal(isDecorativeEcho('Biryani', 'Clay Pot Biryani'), false, 'only capitals')
  assert.equal(isDecorativeEcho('SOUP', 'Clay Pot Biryani'), false)

  const result = parseRows([
    ['Clay Pot Biryani'],
    ['BIRYANI'],
    ['Clay Pot Chicken Biryani', '350'],
  ])

  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].name, 'Clay Pot Biryani')
})

test('hands back a row it cannot read rather than inventing a price', () => {
  const result = parseRows([
    ['Starters'],
    ['Chicken Lollipop', 'ask staff'],
    ['Paneer Tikka', '230'],
  ])

  assert.equal(find(result, 'Paneer Tikka').item.price, '230')
  assert.equal(find(result, 'Chicken Lollipop'), null, 'not imported on a guess')
  assert.equal(result.stats.unparsed, 1)
  assert.deepEqual(result.unparsed[0], ['Chicken Lollipop', 'ask staff'])
})

test('skips titles and taglines that carry no price', () => {
  const result = parseRows([
    ['MENU'],
    ['A Royal Journey of Authentic Flavours'],
    ['Biryani'],
    ['Chicken Dum Biryani', '160'],
  ])

  assert.equal(result.stats.dishes, 1)
  assert.equal(result.stats.unparsed, 0, 'a tagline is not an unreadable dish')
})

test('files dishes with no heading under Uncategorised', () => {
  const result = parseRows([['Chicken Masala', '220']])
  assert.equal(result.categories[0].name, 'Uncategorised')
})

test('survives empty and malformed input', () => {
  for (const input of [null, undefined, [], [[]], [['']], [null, ['x']]]) {
    const result = parseRows(input)
    assert.ok(Array.isArray(result.categories))
    assert.equal(typeof result.stats.dishes, 'number')
  }
})

/* ------------------- labels that do not arrive one per cell --------------- */

const { expandPortionCell, portionLabelsOf } = require('../parseRows')

test('portion labels sharing one cell are still labels', () => {
  // Pasted text separated by single spaces arrives as one cell.
  assert.deepEqual(expandPortionCell('Quarter Half Full'), ['Quarter', 'Half', 'Full'])
  // A real menu whose columns sit close together: "Half Quarter" stuck together.
  assert.deepEqual(expandPortionCell('Half Quarter'), ['Half', 'Quarter'])
  assert.deepEqual(expandPortionCell('Chicken / Mutton'), ['Chicken', 'Mutton'])
  assert.deepEqual(expandPortionCell('Full'), ['Full'])

  // Not labels: a dish name, or a heading that merely starts with a label word.
  assert.equal(expandPortionCell('Pepper Grill'), null)
  assert.equal(expandPortionCell('Full Plate Meals'), null)
  assert.equal(expandPortionCell(''), null)
})

test('portionLabelsOf reads a row however the labels are split', () => {
  assert.deepEqual(portionLabelsOf(['Quarter', 'Half', 'Full']), ['Quarter', 'Half', 'Full'])
  assert.deepEqual(portionLabelsOf(['Quarter Half Full']), ['Quarter', 'Half', 'Full'])
  assert.deepEqual(portionLabelsOf(['Full', 'Half Quarter']), ['Full', 'Half', 'Quarter'])
  assert.equal(portionLabelsOf(['Pepper Grill', '420']), null)
})

test('space-separated labels give each dish its own portions', () => {
  // This is the case that failed in the browser: the labels line pasted with
  // single spaces, so three clearly printed prices were reported as unlabelled
  // and the review screen asked what each one meant.
  const result = parseRows([
    ['Grill Chicken'],
    ['Quarter Half Full'],
    ['Pepper Grill', '150', '230', '420'],
    ['Peri Peri Grill', '150', '230', '420'],
  ])

  assert.equal(result.stats.ambiguous, 0, 'nothing should need asking about')

  for (const name of ['Pepper Grill', 'Peri Peri Grill']) {
    assert.deepEqual(find(result, name).item.portions, [
      { label: 'Quarter', price: '150' },
      { label: 'Half', price: '230' },
      { label: 'Full', price: '420' },
    ], name)
  }
})

test('labels split across cells line up with the prices', () => {
  // Page 4 of the real menu prints "Full | Half Quarter".
  const result = parseRows([
    ['Barbeque'],
    ['Full', 'Half Quarter'],
    ['Barbeque Chicken', '440', '250', '150'],
  ])

  assert.deepEqual(find(result, 'Barbeque Chicken').item.portions, [
    { label: 'Full', price: '440' },
    { label: 'Half', price: '250' },
    { label: 'Quarter', price: '150' },
  ])
})

test('a dish name made of portion words is not mistaken for labels', () => {
  // "Full Plate Meals" is a heading; "Half Plate" priced alone is a dish.
  const result = parseRows([
    ['Full Plate Meals'],
    ['Veg Meals', '120'],
  ])
  assert.equal(result.categories[0].name, 'Full Plate Meals')
  assert.equal(find(result, 'Veg Meals').item.price, '120')
})


test('a not-sold column inside the name cell keeps the other prices aligned', () => {
  // "Paneer Mandi 1100 570 -" arrives as one cell when the paste uses single
  // spaces. An earlier version stopped at the dash and dropped the dish
  // entirely; losing a dish is the worst outcome this parser can have.
  const result = parseRows([
    ['Arabian Mandi', 'Full', 'Half', 'Quarter'],
    ['Paneer Mandi 1100 570 -'],
  ])

  const hit = find(result, 'Paneer Mandi')
  assert.ok(hit, 'the dish must not disappear')
  assert.deepEqual(hit.item.portions, [
    { label: 'Full', price: '1100' },
    { label: 'Half', price: '570' },
  ])
  assert.equal(result.stats.unparsed, 0)
})

test('a dash in the middle does not shift later prices onto wrong labels', () => {
  // Half is not sold. Quarter must stay 450, not take Half's label.
  const result = parseRows([
    ['Mandi', 'Full', 'Half', 'Quarter'],
    ['Odd Mandi', '1600', '-', '450'],
  ])

  assert.deepEqual(find(result, 'Odd Mandi').item.portions, [
    { label: 'Full', price: '1600' },
    { label: 'Quarter', price: '450' },
  ])
})

/* ------------- currency formats, short names, units ---------------------- */

test('reads every currency format a menu prints', () => {
  const cases = [
    ['Plain Price 190', 'Plain Price', '190'],
    ['Rupee Symbol ₹220', 'Rupee Symbol', '220'],
    ['Rs Prefix Rs. 230', 'Rs Prefix', '230'],
    ['Slash Suffix 240/-', 'Slash Suffix', '240'],
    ['Comma Thousand 1,250', 'Comma Thousand', '1250'],
    ['Decimal Price 99.50', 'Decimal Price', '99.50'],
  ]

  for (const [line, name, price] of cases) {
    const split = splitNameAndPrices(line)
    assert.equal(split.name, name, line)
    assert.deepEqual(split.prices, [price], line)
  }
})

test('a two-letter dish name is still a dish', () => {
  // "7 Up 60" was dropped entirely: the name test demanded three consecutive
  // letters, so the row failed to parse and then failed to reach review.
  const result = parseRows([['Drinks'], ['7 Up 60'], ['Soda 2 Litre 90']])

  assert.equal(find(result, '7 Up').item.price, '60')
  assert.equal(find(result, 'Soda 2 Litre').item.price, '90')
  assert.equal(result.stats.unparsed, 0)
})

test('a quantity and its unit are one portion label', () => {
  // Cakes sell by weight and bottles by volume. Splitting "Half Kg" into two
  // labels gave four labels for two price columns, so every cake was reported
  // as unlabelled and sent to review for nothing.
  assert.deepEqual(expandPortionCell('Half Kg 1 Kg'), ['Half Kg', '1 Kg'])
  assert.deepEqual(expandPortionCell('250ml 500ml'), ['250ml', '500ml'])
  assert.deepEqual(expandPortionCell('Single Scoop Double Scoop'),
    ['Single Scoop', 'Double Scoop'])

  // A unit on its own labels nothing, and a dish name is not labels.
  assert.equal(expandPortionCell('Water Bottle'), null)
  assert.equal(expandPortionCell('Pepper Grill'), null)
})

test('cakes priced by weight get their own portions', () => {
  const result = parseRows([
    ['Cakes'],
    ['Half Kg 1 Kg'],
    ['Black Forest', '450', '850'],
  ])

  assert.deepEqual(find(result, 'Black Forest').item.portions, [
    { label: 'Half Kg', price: '450' },
    { label: '1 Kg', price: '850' },
  ])
  assert.equal(result.stats.ambiguous, 0)
})

/* ------------- a dish whose name ends in a number ------------------------ */

test('a number in the dish name is not taken as its price', () => {
  // Reported from a real menu: "Chicken 65" with its price in a separate
  // column imported as "Chicken" priced 65, and the real price was lost.
  const result = parseRows([
    ['STARTERS'],
    ['Chicken 65', '190'],
    ['Paneer 65', '170'],
    ['Chicken 65 Bone (8 Pcs)', '190'],
  ])

  assert.equal(find(result, 'Chicken 65').item.price, '190')
  assert.equal(find(result, 'Paneer 65').item.price, '170')
  assert.equal(find(result, 'Chicken 65 Bone (8 Pcs)').item.price, '190')
  assert.equal(result.stats.ambiguous, 0, 'nothing should be ambiguous here')
})

test('a lone cell that swallowed its prices is still split', () => {
  // The opposite case must keep working: no other cell carries a price, so the
  // numbers at the end of the name really are the prices.
  const result = parseRows([
    ['Barbeque'],
    ['Full', 'Half', 'Quarter'],
    ['Pepper Barbeque Chicken 450 250 160'],
  ])

  assert.deepEqual(find(result, 'Pepper Barbeque Chicken').item.portions, [
    { label: 'Full', price: '450' },
    { label: 'Half', price: '250' },
    { label: 'Quarter', price: '160' },
  ])
})

test('"Dish" as a column heading does not become a category', () => {
  // "Dish | Quarter | Half | Full" is a table header. Treating the first cell
  // as a section name filed the grills under a category called "Dish".
  const result = parseRows([
    ['GRILLS'],
    ['Dish', 'Quarter', 'Half', 'Full'],
    ['Grill Chicken', '140', '200', '420'],
  ])

  assert.equal(find(result, 'Grill Chicken').category, 'GRILLS')
  assert.ok(!result.categories.some((c) => c.name === 'Dish'))
})

/* ------------- labels a camera got slightly wrong ------------------------ */

const { canonicalPortion, isPortionWord } = require('../parseRows')

test('a portion label misread by OCR is still recognised', () => {
  // Reading a photograph, l / I / 1 are the same few pixels, so "Full" comes
  // back as "Ful" or "FuII". Demanding an exact match meant every biryani lost
  // its Half and Full prices and became two unlabelled numbers.
  for (const misread of ['Ful', 'FuII', 'FuIl', 'Fuli']) {
    assert.ok(isPortionWord(misread), misread + ' should be read as a label')
  }
  for (const misread of ['Haif', 'Ouarter', 'Quartcr', 'Smali', 'Larqe']) {
    assert.ok(isPortionWord(misread), misread)
  }
})

test('a misread label is stored correctly spelled', () => {
  // The customer must not be shown "Ful".
  assert.equal(canonicalPortion('Ful'), 'Full')
  assert.equal(canonicalPortion('FuII'), 'Full')
  assert.equal(canonicalPortion('Haif'), 'Half')
  assert.equal(canonicalPortion('Ouarter'), 'Quarter')
  assert.equal(canonicalPortion('Dry'), 'Dry')
})

test('a table heading is never a portion label', () => {
  // Tolerating OCR errors made this urgent: "Dish" is one letter from "Fish",
  // which IS a label on menus priced by meat. Counting the heading as a label
  // gave three labels for two price columns and lost both prices.
  for (const heading of ['Dish', 'Item', 'Name', 'Price', 'Rate']) {
    assert.equal(isPortionWord(heading), false, heading)
  }
  // Words that must stay labels.
  for (const label of ['Fish', 'Dry', 'Half', 'Quarter']) {
    assert.ok(isPortionWord(label), label)
  }
})

test('a biryani table with misread headings keeps its portions', () => {
  const result = parseRows([
    ['BIRYANI'],
    ['Dish', 'Haif', 'FuII'],
    ['Chicken Biryani', '180', '320'],
    ['Mutton Biryani', '240', '430'],
  ])

  assert.equal(result.stats.ambiguous, 0)
  assert.deepEqual(find(result, 'Chicken Biryani').item.portions, [
    { label: 'Half', price: '180' },
    { label: 'Full', price: '320' },
  ])
  assert.equal(find(result, 'Mutton Biryani').category, 'BIRYANI')
})

test('the restaurant name is not imported as a dish', () => {
  // "ANBUDE   CAFE" arrives as separate cells because the title is widely
  // spaced. It was being reported as a dish whose price could not be read.
  const result = parseRows([
    ['ANBUDE', 'CAFE'],
    ['STARTERS'],
    ['Chicken 65', '190'],
  ])

  assert.equal(result.stats.dishes, 1)
  assert.equal(result.stats.unparsed, 0, 'the banner must not be flagged as a dish')
  assert.equal(find(result, 'Chicken 65').item.price, '190')
  assert.ok(!result.categories.some((c) => c.items.some((i) => /ANBUDE/i.test(i.name))))
})

/* ---- sizes printed inside the dish name, as "(F/H/Q)" ---- */

const { labelsFromName } = require('../portion')

test('F/H/Q in the name becomes Full, Half and Quarter', () => {
  const found = labelsFromName('Piri Piri Tandoori Chi. (F/H/Q)')
  assert.deepStrictEqual(found, {
    base: 'Piri Piri Tandoori Chi.',
    labels: ['Full', 'Half', 'Quarter'],
  })
})

test('written-out sizes in the name work too', () => {
  assert.deepStrictEqual(labelsFromName('Rice (Full/Half)').labels, ['Full', 'Half'])
  assert.deepStrictEqual(labelsFromName('Soup (S/M/L)').labels, ['Small', 'Medium', 'Large'])
})

test('brackets that are not sizes are left alone', () => {
  // Bone and boneless, not Big and Large.
  assert.strictEqual(labelsFromName('Chicken (B/L)'), null)
  assert.strictEqual(labelsFromName('Chicken 65 (bone)'), null)
  assert.strictEqual(labelsFromName('Gobi 65 (5 Pcs)'), null)
  assert.strictEqual(labelsFromName('Plain Dish'), null)
})

test('the same size twice is a misread, not a menu', () => {
  assert.strictEqual(labelsFromName('Thing (F/F)'), null)
})

test('a name that is only sizes is not a dish', () => {
  assert.strictEqual(labelsFromName('(F/H/Q)'), null)
})

test('a dish with sizes in its name is imported with portions, not an ambiguous price', () => {
  const result = parseRows([
    ['Special Dish'],
    ['Piri Piri Tandoori Chi. (F/H/Q)', '510/300/200'],
  ])

  const item = result.categories[0].items[0]
  assert.strictEqual(item.name, 'Piri Piri Tandoori Chi.')
  // Prices are strings all the way through this parser; the database layer
  // converts them. Portions follow the same rule as every other price here.
  assert.deepStrictEqual(item.portions, [
    { label: 'Full', price: '510' },
    { label: 'Half', price: '300' },
    { label: 'Quarter', price: '200' },
  ])
  assert.strictEqual(result.stats.ambiguous, 0)
})

test('a single size in the name stays part of the name', () => {
  // With three prices the brackets describe three columns and come off.
  // With one price "(Q)" is what the dish IS - a quarter chicken - and the
  // menu says so on purpose. Stripping it would lose what the diner ordered.
  const result = parseRows([
    ['Special Dish'],
    ['Corindar Chicken (Q)', '190'],
  ])
  const item = result.categories[0].items[0]
  assert.strictEqual(item.name, 'Corindar Chicken (Q)')
  assert.strictEqual(item.price, '190')
})

test('sizes that do not match the number of prices are still flagged', () => {
  // Two labels, three prices: something was misread, so do not place them.
  const result = parseRows([
    ['Special Dish'],
    ['Something (F/H)', '510/300/200'],
  ])
  assert.strictEqual(result.stats.ambiguous, 1)
})
