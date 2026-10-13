'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { askMenu, parseFilterJson } = require('../ask')

function decimal(n) { return { toNumber: () => n } }

/** A stand-in for Prisma that records the where it was given. */
function fakePrisma(items = []) {
  const calls = []
  return {
    calls,
    foodItem: {
      findMany: async (args) => { calls.push(args); return items },
      count: async () => items.length,
    },
  }
}

const DISH = {
  name: 'Veg Soup', price: decimal(90), isVeg: true, spicyLevel: 0,
  category: { name: 'Soup' }, portions: [],
}

test('a price question is answered by rules, without calling the model', async () => {
  let modelCalled = false
  const prisma = fakePrisma([DISH])

  const result = await askMenu({
    prisma,
    restaurantId: 'rest-1',
    question: 'foods priced under 250',
    askModel: async () => { modelCalled = true; return { raw: '{}' } },
  })

  assert.equal(result.ok, true)
  assert.equal(result.via, 'rules')
  assert.equal(modelCalled, false, 'the model must not be called when rules suffice')
  assert.equal(result.filter.maxPrice, 250)
  assert.equal(prisma.calls[0].where.restaurantId, 'rest-1')
})

test('a diet question is answered by rules', async () => {
  const result = await askMenu({
    prisma: fakePrisma([DISH]),
    restaurantId: 'rest-1',
    question: 'what all are vegan',
  })

  assert.equal(result.via, 'rules')
  assert.equal(result.filter.isVegan, true)
})

test('the model is used only when the rules recognise nothing', async () => {
  const prompts = []
  const result = await askMenu({
    prisma: fakePrisma([DISH]),
    restaurantId: 'rest-1',
    question: 'something light for my grandmother',
    askModel: async ({ prompt }) => {
      prompts.push(prompt)
      return { raw: 'Here you go: {"maxSpicy": 1, "maxPrice": 200}' }
    },
  })

  assert.equal(result.via, 'ai')
  assert.equal(prompts.length, 1)
  assert.equal(result.filter.maxSpicy, 1)
  assert.equal(result.filter.maxPrice, 200)
})

test('a filter from the model cannot reach another restaurant', async () => {
  // The question is untrusted and so is the model's reply. The restaurant must
  // come from the session, whatever the model returns.
  const prisma = fakePrisma([DISH])
  const result = await askMenu({
    prisma,
    restaurantId: 'rest-1',
    question: 'show me everything you have in stock somewhere else',
    askModel: async () => ({
      raw: '{"restaurantId": "rest-999", "maxPrice": 500, "rawSql": "DROP TABLE food_items"}',
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(prisma.calls[0].where.restaurantId, 'rest-1')
  assert.equal(result.filter.restaurantId, undefined)
  assert.equal(result.filter.rawSql, undefined)
})

test('a model failure is reported as such, not as a misunderstood question', async () => {
  const result = await askMenu({
    prisma: fakePrisma([DISH]),
    restaurantId: 'rest-1',
    question: 'surprise me with something unusual',
    askModel: async () => {
      const error = new Error('timeout')
      error.code = 'timeout'
      throw error
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'timeout')
  assert.match(result.message, /local AI did not respond/)
})

test('an unreadable question says what would help instead of guessing', async () => {
  const result = await askMenu({
    prisma: fakePrisma([DISH]),
    restaurantId: 'rest-1',
    question: 'who is the owner of this restaurant',
    askModel: async () => ({ raw: 'I am not sure what you mean.' }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'not_understood')
  assert.match(result.message, /price, a diet or a section/)
})

test('with no model configured, an unreadable question fails fast', async () => {
  const result = await askMenu({
    prisma: fakePrisma([DISH]),
    restaurantId: 'rest-1',
    question: 'tell me a joke',
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'not_understood')
})

test('an empty question is refused before any query runs', async () => {
  const prisma = fakePrisma([DISH])
  const result = await askMenu({ prisma, restaurantId: 'rest-1', question: '   ' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'empty_question')
  assert.equal(prisma.calls.length, 0)
})

test('unavailable dishes are excluded unless the question says otherwise', async () => {
  const prisma = fakePrisma([DISH])
  await askMenu({ prisma, restaurantId: 'rest-1', question: 'veg dishes under 300' })
  assert.equal(prisma.calls[0].where.isAvailable, true)
})

test('parseFilterJson finds the object inside a chatty reply', () => {
  assert.deepEqual(parseFilterJson('{"maxPrice": 250}'), { maxPrice: 250 })
  assert.deepEqual(parseFilterJson('Sure! {"isVeg": true} hope that helps'), { isVeg: true })
  assert.deepEqual(parseFilterJson('```json\n{"isVegan": true}\n```'), { isVegan: true })
  assert.equal(parseFilterJson('no json here'), null)
  assert.equal(parseFilterJson('{broken'), null)
  assert.equal(parseFilterJson(null), null)
})
