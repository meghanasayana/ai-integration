'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { validateIntent } = require('../intentSchema')
const { resolveDish } = require('../resolveDish')
const { buildChangePlan } = require('../buildChangePlan')

/* A small, realistic menu used as the "current state" for every test. */
const MENU = {
  categories: [{ id: 'c1', name: 'Starters' }, { id: 'c2', name: 'Grills' }],
  dishes: [
    { id: 'd1', name: 'Chicken 65', categoryName: 'Starters', price: 190, isAvailable: true, portions: [] },
    { id: 'd2', name: 'Chicken Manchurian', categoryName: 'Starters', price: 190, isAvailable: true, portions: [] },
    {
      id: 'd3', name: 'Grill Chicken', categoryName: 'Grills', price: 140, isAvailable: true,
      portions: [
        { portion: 'Quarter', price: 140 },
        { portion: 'Half', price: 200 },
        { portion: 'Full', price: 420 },
      ],
    },
    { id: 'd4', name: 'Pepper Grill', categoryName: 'Grills', price: 150, isAvailable: true, portions: [] },
    { id: 'd5', name: 'Peri Peri Grill', categoryName: 'Grills', price: 160, isAvailable: false, portions: [] },
  ],
}

function plan(action, args) {
  const intent = validateIntent({ action, arguments: args })
  assert.equal(intent.ok, true, JSON.stringify(intent))
  return buildChangePlan(intent, MENU)
}

/* ------------------------------------------------------- intent validation */

test('an action outside the catalogue is refused', () => {
  const result = validateIntent({ action: 'drop_table', arguments: {} })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unknown_action')
})

test('raw SQL is never a valid action', () => {
  assert.equal(validateIntent({ action: 'DELETE FROM food_items', arguments: {} }).ok, false)
  assert.equal(validateIntent({ action: 'query', arguments: { sql: 'SELECT 1' } }).ok, false)
})

test('missing required arguments are reported, not filled in', () => {
  const result = validateIntent({ action: 'update_price', arguments: { dishName: 'Chicken 65' } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_arguments')
  assert.deepEqual(result.missing, ['price'])
})

test('undeclared arguments are dropped', () => {
  const result = validateIntent({
    action: 'set_availability',
    arguments: { dishName: 'Chicken 65', isAvailable: false, restaurantId: 'someone-elses' },
  })
  assert.equal(result.ok, true)
  assert.equal(result.arguments.restaurantId, undefined)
})

test('availability accepts booleans and their string forms only', () => {
  assert.equal(validateIntent({ action: 'set_availability', arguments: { dishName: 'x', isAvailable: 'false' } }).arguments.isAvailable, false)
  assert.equal(validateIntent({ action: 'set_availability', arguments: { dishName: 'x', isAvailable: 'maybe' } }).ok, false)
})

test('malformed JSON is refused', () => {
  assert.equal(validateIntent('not json at all').ok, false)
  assert.equal(validateIntent('{"action":').ok, false)
})

/* ------------------------------------------------------------- resolution */

test('an exact name resolves to one dish', () => {
  const result = resolveDish('chicken 65', MENU.dishes)
  assert.equal(result.status, 'resolved')
  assert.equal(result.dish.id, 'd1')
})

test('a partial name never auto-selects', () => {
  const result = resolveDish('Grill', MENU.dishes)
  assert.equal(result.status, 'ambiguous')
  assert.ok(result.candidates.length > 1)
})

test('an unknown dish is not found rather than approximated', () => {
  assert.equal(resolveDish('Lasagne', MENU.dishes).status, 'not_found')
})

/* ------------------------------------------------------- every write asks */

test('every writing action requires confirmation', () => {
  const writes = [
    ['create_category', { categoryName: 'Soups' }],
    ['add_dish', { dishName: 'Tomato Soup', categoryName: 'Starters', price: '120' }],
    ['update_price', { dishName: 'Chicken 65', price: '210' }],
    ['set_availability', { dishName: 'Chicken 65', isAvailable: false }],
    ['move_dish', { dishName: 'Chicken 65', categoryName: 'Grills' }],
    ['delete_dish', { dishName: 'Chicken 65' }],
  ]
  for (const [action, args] of writes) {
    assert.equal(plan(action, args).requiresConfirmation, true, `${action} did not require confirmation`)
  }
})

test('reading the menu changes nothing and needs no confirmation', () => {
  const result = plan('show_menu', {})
  assert.equal(result.requiresConfirmation, false)
  assert.deepEqual(result.changes, [])
})

/* ------------------------------------------------------------ price edits */

test('a simple price change shows the before and after', () => {
  const result = plan('update_price', { dishName: 'Chicken 65', price: '₹210' })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.changes, [{ field: 'price', from: 190, to: 210 }])
})

test('a multi-portion dish will not accept a bare price change', () => {
  const result = plan('update_price', { dishName: 'Grill Chicken', price: '250' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'portion_required'))
})

test('a portion price change targets the right portion', () => {
  const result = plan('update_price', { dishName: 'Grill Chicken', price: '240', portion: 'Half' })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.changes, [{ field: 'portion:Half', from: 200, to: 240 }])
})

test('portion aliases work in conversation', () => {
  const result = plan('update_price', { dishName: 'Grill Chicken', price: '160', portion: '1/4' })
  assert.deepEqual(result.changes, [{ field: 'portion:Quarter', from: 140, to: 160 }])
})

test('a portion the dish does not have is refused with the real options', () => {
  const result = plan('update_price', { dishName: 'Grill Chicken', price: '300', portion: 'Large' })
  assert.equal(result.status, 'blocked')
  const warning = result.warnings.find((w) => w.code === 'portion_not_found')
  assert.ok(warning.message.includes('Quarter'))
})

test('an unreadable price is refused, never approximated', () => {
  const result = plan('update_price', { dishName: 'Chicken 65', price: 'about two hundred' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'unreadable_price'))
})

test('a negative price is refused', () => {
  assert.equal(plan('update_price', { dishName: 'Chicken 65', price: '-50' }).status, 'blocked')
})

test('a suspicious price is flagged but still allowed with confirmation', () => {
  const result = plan('update_price', { dishName: 'Chicken 65', price: '999999' })
  assert.equal(result.status, 'ready')
  assert.ok(result.warnings.some((w) => w.code === 'price_unusually_high'))
  assert.equal(result.requiresConfirmation, true)
})

/* ------------------------------------------------------------- ambiguity */

test('an ambiguous dish name asks instead of acting', () => {
  const result = plan('update_price', { dishName: 'Grill', price: '300' })
  assert.equal(result.status, 'needs_choice')
  assert.deepEqual(result.changes, [])
  assert.ok(result.candidates.length > 1)
  assert.ok(result.warnings.some((w) => w.code === 'ambiguous_dish'))
})

test('similar names are offered as a choice, never merged', () => {
  const result = plan('set_availability', { dishName: 'Peper Grill', isAvailable: false })
  assert.notEqual(result.status, 'ready')
  const names = result.candidates.map((c) => c.name)
  assert.ok(names.includes('Pepper Grill'))
})

test('a dish that does not exist is reported, not created', () => {
  const result = plan('update_price', { dishName: 'Lasagne', price: '300' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'dish_not_found'))
})

/* -------------------------------------------------------------- deletion */

test('deletion of an exact match is allowed, flagged irreversible', () => {
  const result = plan('delete_dish', { dishName: 'Chicken 65' })
  assert.equal(result.status, 'ready')
  assert.equal(result.destructive, true)
  assert.equal(result.requiresConfirmation, true)
  assert.ok(result.warnings.some((w) => w.code === 'irreversible'))
})

test('deletion on a close match is refused outright', () => {
  const result = plan('delete_dish', { dishName: 'Grill' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'exact_match_required'))
  assert.deepEqual(result.changes, [])
})

/* ------------------------------------------------- availability and moves */

test('marking a dish sold out records the exact transition', () => {
  const result = plan('set_availability', { dishName: 'Chicken 65', isAvailable: false })
  assert.deepEqual(result.changes, [{ field: 'isAvailable', from: true, to: false }])
})

test('a no-op is surfaced rather than silently applied', () => {
  const result = plan('set_availability', { dishName: 'Peri Peri Grill', isAvailable: false })
  assert.ok(result.warnings.some((w) => w.code === 'no_change'))
})

test('moving a dish shows both categories', () => {
  const result = plan('move_dish', { dishName: 'Chicken 65', categoryName: 'Grills' })
  assert.deepEqual(result.changes, [{ field: 'category', from: 'Starters', to: 'Grills' }])
})

test('moving into a new category warns that it will be created', () => {
  const result = plan('move_dish', { dishName: 'Chicken 65', categoryName: 'Tandoori' })
  assert.ok(result.warnings.some((w) => w.code === 'new_category'))
})

/* ------------------------------------------------------ adding and categories */

test('adding a dish that already exists is refused with advice', () => {
  const result = plan('add_dish', { dishName: 'Chicken 65', categoryName: 'Starters', price: '200' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'already_exists'))
})

test('adding a dish with portions derives the base price', () => {
  const result = plan('add_dish', {
    dishName: 'Tandoori Chicken',
    categoryName: 'Grills',
    portions: [{ label: 'Half', price: '260' }, { label: 'Full', price: '480' }],
  })
  assert.equal(result.status, 'ready')
  assert.ok(result.changes.some((c) => c.field === 'price' && c.to === 260))
})

test('adding a dish without a price is refused', () => {
  const result = plan('add_dish', { dishName: 'Mystery Dish', categoryName: 'Starters' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'no_price'))
})

test('a duplicate category is refused', () => {
  const result = plan('create_category', { categoryName: 'starters' })
  assert.equal(result.status, 'blocked')
  assert.ok(result.warnings.some((w) => w.code === 'already_exists'))
})
