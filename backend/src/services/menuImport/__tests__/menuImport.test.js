'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { parsePrice, splitCombinedPrices } = require('../price')
const { normalisePortion, findDuplicatePortions } = require('../portion')
const { normaliseName, isSuspiciouslySimilar } = require('../dishName')
const { validateAiOutput } = require('../validateAiOutput')
const { buildImportPlan } = require('../buildImportPlan')

/* ------------------------------------------------------------------ price */

test('parsePrice reads the formats menus actually use', () => {
  assert.equal(parsePrice('190').value, 190)
  assert.equal(parsePrice('₹190').value, 190)
  assert.equal(parsePrice('Rs. 190').value, 190)
  assert.equal(parsePrice('190/-').value, 190)
  assert.equal(parsePrice('1,250').value, 1250)
  assert.equal(parsePrice('190.00').value, 190)
  assert.equal(parsePrice('  ₹ 220  ').value, 220)
  assert.equal(parsePrice(190).value, 190)
})

test('parsePrice refuses anything it cannot read', () => {
  assert.equal(parsePrice('').ok, false)
  assert.equal(parsePrice(null).ok, false)
  assert.equal(parsePrice('market price').ok, false)
  assert.equal(parsePrice('-50').ok, false)
  assert.equal(parsePrice('19.999').ok, false)
})

test('parsePrice treats a merged cell as ambiguous, never picks one', () => {
  const result = parsePrice('110 / 140')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'multiple_values')
})

test('parsePrice warns on zero and absurd values rather than silently accepting', () => {
  assert.deepEqual(parsePrice('0').warnings, ['price_is_zero'])
  assert.deepEqual(parsePrice('999999').warnings, ['price_unusually_high'])
})

test('splitCombinedPrices separates without interpreting', () => {
  assert.deepEqual(splitCombinedPrices('110 / 140'), ['110', '140'])
  assert.deepEqual(splitCombinedPrices('140-200-420'), ['140', '200', '420'])
})

/* ---------------------------------------------------------------- portion */

test('portion aliases collapse onto one canonical value', () => {
  for (const alias of ['Quarter', 'quarter', '1/4', '¼', 'Qtr', 'QUARTER PLATE']) {
    assert.equal(normalisePortion(alias).canonical, 'quarter', `failed on "${alias}"`)
  }
  for (const alias of ['Half', '1/2', '½', 'half plate']) {
    assert.equal(normalisePortion(alias).canonical, 'half', `failed on "${alias}"`)
  }
  for (const alias of ['Full', 'full plate', 'Regular']) {
    assert.equal(normalisePortion(alias).canonical, 'full', `failed on "${alias}"`)
  }
})

test('size and piece-count portions are understood', () => {
  assert.equal(normalisePortion('Small').canonical, 'small')
  assert.equal(normalisePortion('M').canonical, 'medium')
  assert.equal(normalisePortion('Large').canonical, 'large')
  assert.equal(normalisePortion('4 pcs').canonical, '4_pieces')
  assert.equal(normalisePortion('8 Pieces').canonical, '8_pieces')
  assert.equal(normalisePortion('8 Pieces').label, '8 Pieces')
})

test('an unfamiliar portion name is kept, not rejected', () => {
  const result = normalisePortion('Family Pack')
  assert.equal(result.ok, true)
  assert.equal(result.recognised, false)
  assert.equal(result.label, 'Family Pack')
})

test('findDuplicatePortions catches Half and 1/2 colliding', () => {
  const canonicals = ['Half', '1/2'].map((l) => normalisePortion(l).canonical)
  assert.deepEqual(findDuplicatePortions(canonicals), ['half'])
})

/* -------------------------------------------------------------- dish name */

test('normaliseName ignores only safe differences', () => {
  assert.equal(normaliseName('Chicken 65'), normaliseName('  chicken   65 '))
  assert.equal(normaliseName('Chicken-65'), normaliseName('Chicken 65'))
})

test('genuinely different dishes are not treated as similar', () => {
  assert.equal(isSuspiciouslySimilar('Pepper Grill', 'Peri Peri Grill'), false)
  assert.equal(isSuspiciouslySimilar('Chicken 65', 'Chicken 65 Boneless'), false)
})

test('near-identical names are surfaced for a human to check', () => {
  assert.equal(isSuspiciouslySimilar('Chicken Manchurian', 'Chiken Manchurian'), true)
})

/* ------------------------------------------------------- output validation */

test('validateAiOutput rejects non-JSON and wrong shapes', () => {
  assert.equal(validateAiOutput('here is your menu!').ok, false)
  assert.equal(validateAiOutput('{"categories":').ok, false)
  assert.equal(validateAiOutput({}).ok, false)
  assert.equal(validateAiOutput({ categories: [] }).ok, false)
  assert.equal(validateAiOutput({ categories: [{ items: [] }] }).ok, false)
})

test('validateAiOutput accepts the agreed shape', () => {
  const result = validateAiOutput({
    categories: [{ name: 'Starters', items: [{ name: 'Chicken 65', price: '190' }] }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.categories[0].items[0].name, 'Chicken 65')
})

/* ------------------------------------------------------------------- plan */

function plan(categories) {
  const validated = validateAiOutput({ categories })
  assert.equal(validated.ok, true, JSON.stringify(validated.errors))
  return buildImportPlan(validated.categories)
}

test('single-price dishes come through ready', () => {
  const { entries, summary } = plan([
    {
      name: 'Starters',
      items: [
        { name: 'Chicken 65', price: '₹190' },
        { name: 'Dragon Chicken', price: '220' },
        { name: 'Chicken Manchurian', price: '190' },
      ],
    },
  ])
  assert.equal(summary.total, 3)
  assert.equal(summary.ready, 3)
  assert.equal(summary.review, 0)
  assert.equal(entries[0].price, 190)
  assert.deepEqual(entries[0].portions, [])
})

test('a quarter/half/full table maps to portions with the lowest as base price', () => {
  const { entries } = plan([
    {
      name: 'Grills',
      items: [
        {
          name: 'Grill Chicken',
          portions: [
            { label: 'Quarter', price: '140' },
            { label: 'Half', price: '200' },
            { label: 'Full', price: '420' },
          ],
        },
      ],
    },
  ])
  const entry = entries[0]
  assert.equal(entry.status, 'ready')
  assert.deepEqual(entry.portions, [
    { portion: 'Quarter', price: 140 },
    { portion: 'Half', price: 200 },
    { portion: 'Full', price: 420 },
  ])
  assert.equal(entry.price, 140)
  assert.equal(entry.basePriceDerivedFrom, 'Quarter')
})

test('two prices with no labels are flagged, never guessed', () => {
  const { entries, summary } = plan([
    { name: 'Soups', items: [{ name: 'Chicken Soup', price: '110 / 140' }] },
  ])
  assert.equal(summary.review, 1)
  assert.equal(entries[0].price, null)
  assert.deepEqual(entries[0].portions, [])
  const warning = entries[0].warnings.find((w) => w.code === 'ambiguous_prices')
  assert.ok(warning, 'expected an ambiguous_prices warning')
  assert.equal(warning.blocking, true)
})

test('a price with no portion name blocks that dish', () => {
  const { entries } = plan([
    {
      name: 'Soups',
      items: [{ name: 'Sweet Corn Soup', portions: [{ label: '', price: '110' }] }],
    },
  ])
  assert.equal(entries[0].status, 'review')
  assert.ok(entries[0].warnings.some((w) => w.code === 'portion_without_label'))
})

test('a dish with no readable price is flagged, not dropped', () => {
  const { entries, summary } = plan([
    { name: 'Specials', items: [{ name: 'Fish of the Day' }] },
  ])
  assert.equal(summary.total, 1)
  assert.equal(entries[0].status, 'review')
  assert.equal(entries[0].price, null)
  assert.ok(entries[0].warnings.some((w) => w.code === 'no_price'))
})

test('Half and 1/2 on the same dish is caught before it hits the unique constraint', () => {
  const { entries } = plan([
    {
      name: 'Grills',
      items: [
        {
          name: 'Pepper Grill',
          portions: [
            { label: 'Half', price: '230' },
            { label: '1/2', price: '230' },
          ],
        },
      ],
    },
  ])
  assert.equal(entries[0].status, 'review')
  assert.ok(entries[0].warnings.some((w) => w.code === 'duplicate_portions'))
})

test('the same dish listed twice in one upload is flagged', () => {
  const { entries } = plan([
    {
      name: 'Starters',
      items: [
        { name: 'Chicken 65', price: '190' },
        { name: 'chicken 65', price: '200' },
      ],
    },
  ])
  assert.equal(entries.length, 2)
  for (const entry of entries) {
    assert.equal(entry.status, 'review')
    assert.ok(entry.warnings.some((w) => w.code === 'duplicate_in_upload'))
  }
})

test('mixed single-price and portioned dishes across categories', () => {
  const { summary, entries } = plan([
    { name: 'Starters', items: [{ name: 'Chicken 65', price: '190' }] },
    {
      name: 'Grills',
      items: [
        {
          name: 'Barbeque Chicken',
          portions: [
            { label: 'Quarter', price: '150' },
            { label: 'Half', price: '250' },
            { label: 'Full', price: '440' },
          ],
        },
      ],
    },
  ])
  assert.equal(summary.total, 2)
  assert.equal(summary.ready, 2)
  assert.deepEqual(summary.categories, ['Starters', 'Grills'])
  assert.equal(entries[0].categoryName, 'Starters')
  assert.equal(entries[1].portions.length, 3)
})

test('unusual portion names are kept but surfaced', () => {
  const { entries } = plan([
    {
      name: 'Biryani',
      items: [{ name: 'Family Biryani', portions: [{ label: 'Family Pack', price: '850' }] }],
    },
  ])
  assert.equal(entries[0].status, 'ready')
  assert.equal(entries[0].portions[0].portion, 'Family Pack')
  assert.ok(entries[0].warnings.some((w) => w.code === 'unusual_portion_name'))
})

/* ------------------------------------------------------------ file support */

const { classifyUpload } = require('../fileSupport')

test('supported menu file types are accepted', () => {
  assert.equal(classifyUpload({ mimetype: 'image/jpeg', size: 1000 }).kind, 'image')
  assert.equal(classifyUpload({ mimetype: 'image/png', size: 1000 }).kind, 'image')
  assert.equal(classifyUpload({ mimetype: 'image/webp', size: 1000 }).kind, 'image')
  assert.equal(classifyUpload({ mimetype: 'application/pdf', size: 1000 }).kind, 'pdf')
})

test('unsupported, empty and oversized files are rejected with a reason', () => {
  assert.equal(classifyUpload({ mimetype: 'text/csv', size: 10 }).code, 'unsupported_type')
  assert.equal(classifyUpload({ mimetype: 'image/png', size: 0 }).code, 'empty_file')
  assert.equal(
    classifyUpload({ mimetype: 'image/png', size: 20 * 1024 * 1024 }).code,
    'too_large',
  )
  assert.equal(classifyUpload({ size: 10 }).code, 'unknown_type')
})

/* ---------------- rows nobody could read must still be shown -------------- */

test('a row the parser cannot read reaches the review list', async () => {
  // Regression: rowsAsReviewItems returns a list of categories, and pushing
  // each category individually into the merge input made mergeCategories skip
  // them silently - 44 rows of a real menu vanished from the review screen
  // while every log line still looked correct.
  const { extractMenuPlanFromText } = require('../index')

  const result = await extractMenuPlanFromText(
    [
      'Soup',
      'Veg Soup 90',
      'Corn Soup 95',
      'Chicken Soup 110 / 140',   // two prices, no labels: parser refuses
    ].join('\n'),
    // No model: the point is that a failed or absent model still shows the row.
    { host: 'http://127.0.0.1:1' },
  )

  assert.equal(result.ok, true)

  const names = result.plan.entries.map((e) => e.name)
  assert.ok(
    names.some((n) => n.includes('Chicken Soup')),
    'the unreadable row must appear somewhere in the plan: ' + JSON.stringify(names),
  )

  const unreadable = result.plan.entries.find((e) => e.name.includes('Chicken Soup'))
  assert.equal(unreadable.status, 'review', 'and it must not be marked ready')
})
