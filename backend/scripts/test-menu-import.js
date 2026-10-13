#!/usr/bin/env node
'use strict'

/**
 * Integration test for the menu importer against a LOCAL database.
 *
 *   node scripts/test-menu-import.js
 *
 * Creates its own throwaway restaurant, imports a menu into it, re-imports
 * the same menu to prove duplicates are prevented, re-imports with changed
 * prices to prove updates work without losing unrelated data, then deletes
 * only the restaurant it created.
 *
 * It refuses to run against anything that is not localhost.
 */

require('dotenv').config()

const prisma = require('../src/lib/prisma')
const { importToDatabase } = require('../src/services/menuImport/importToDatabase')

/* ---------------------------------------------------------------- guard */

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. Refusing to run.')
    process.exit(2)
  }

  let host
  try {
    host = new URL(url).hostname
  } catch {
    console.error('DATABASE_URL could not be parsed. Refusing to run.')
    process.exit(2)
  }

  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error('')
    console.error('  REFUSING TO RUN.')
    console.error(`  DATABASE_URL points at "${host}", not localhost.`)
    console.error('  This test creates and deletes records. It only runs locally.')
    console.error('')
    process.exit(2)
  }

  console.log(`Database host: ${host}  (safe)\n`)
}

/* ----------------------------------------------------------- assertions */

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed += 1
  } else {
    console.log(`  FAIL  ${label}`)
    if (detail !== undefined) console.log(`        got: ${JSON.stringify(detail)}`)
    failed += 1
  }
}

/* ---------------------------------------------------------------- fixture */

const MENU = [
  { name: 'Chicken 65', categoryName: 'Starters', price: 190, portions: [] },
  { name: 'Dragon Chicken', categoryName: 'Starters', price: 220, portions: [] },
  {
    name: 'Grill Chicken',
    categoryName: 'Grills',
    price: 140,
    portions: [
      { portion: 'Quarter', price: 140 },
      { portion: 'Half', price: 200 },
      { portion: 'Full', price: 420 },
    ],
  },
]

async function main() {
  assertLocalDatabase()

  const slug = `import-test-${Date.now()}`
  const restaurant = await prisma.restaurant.create({
    data: { name: 'Import Test Kitchen', slug },
    select: { id: true, slug: true },
  })
  console.log(`Created throwaway restaurant: ${restaurant.slug}\n`)

  try {
    /* ---------------------------------------------------- first import */
    console.log('1. First import')
    const first = await importToDatabase({
      prisma,
      restaurantId: restaurant.id,
      entries: MENU,
    })

    check('3 dishes created', first.created.length === 3, first.created.length)
    check('2 categories created', first.categoriesCreated.length === 2, first.categoriesCreated)
    check('3 portions created', first.portionsCreated === 3, first.portionsCreated)

    const grill = await prisma.foodItem.findFirst({
      where: { restaurantId: restaurant.id, name: 'Grill Chicken' },
      include: { portions: true, category: true },
    })
    check('portions attached to the right dish', (grill.portions || []).length === 3, grill.portions.length)
    check('base price is the lowest portion', Number(grill.price) === 140, Number(grill.price))
    check('category assigned', grill.category && grill.category.name === 'Grills', grill.category?.name)

    /* ------------------------------------------- re-import, unchanged */
    console.log('\n2. Re-import the same menu (duplicate prevention)')
    const second = await importToDatabase({
      prisma,
      restaurantId: restaurant.id,
      entries: MENU,
    })

    check('no new dishes created', second.created.length === 0, second.created.length)
    check('no new categories created', second.categoriesCreated.length === 0, second.categoriesCreated)
    check('no new portions created', second.portionsCreated === 0, second.portionsCreated)
    check('all 3 reported unchanged', second.unchanged.length === 3, second.unchanged.length)

    const totalAfter = await prisma.foodItem.count({ where: { restaurantId: restaurant.id } })
    check('still exactly 3 dishes in the database', totalAfter === 3, totalAfter)

    /* ------------------------------ unrelated fields must survive an update */
    console.log('\n3. Price change preserves unrelated data')
    await prisma.foodItem.update({
      where: { id: grill.id },
      data: {
        description: 'Chargrilled, served with mint chutney',
        imageUrl: 'https://example.test/grill.jpg',
        isVeg: false,
        spicyLevel: 2,
      },
    })

    const third = await importToDatabase({
      prisma,
      restaurantId: restaurant.id,
      entries: [
        {
          name: 'Grill Chicken',
          categoryName: 'Grills',
          price: 150,
          portions: [
            { portion: 'Quarter', price: 150 },
            { portion: 'Half', price: 200 },
            { portion: 'Full', price: 450 },
          ],
        },
      ],
    })

    const after = await prisma.foodItem.findUnique({
      where: { id: grill.id },
      include: { portions: true },
    })

    check('dish reported as updated', third.updated.length === 1, third.updated.length)
    check('no duplicate dish created', third.created.length === 0, third.created.length)
    check('description survived', after.description === 'Chargrilled, served with mint chutney', after.description)
    check('image survived', after.imageUrl === 'https://example.test/grill.jpg', after.imageUrl)
    check('spicyLevel survived', after.spicyLevel === 2, after.spicyLevel)
    check('dish id unchanged', after.id === grill.id)
    check('2 portion prices updated', third.portionsUpdated === 2, third.portionsUpdated)
    check('still exactly 3 portions', after.portions.length === 3, after.portions.length)

    const half = after.portions.find((p) => p.portion === 'Half')
    const full = after.portions.find((p) => p.portion === 'Full')
    check('unchanged portion left alone', Number(half.price) === 200, Number(half.price))
    check('changed portion updated', Number(full.price) === 450, Number(full.price))

    /* ---------------------------------- absent dishes are never deleted */
    console.log('\n4. Dishes missing from an upload are never deleted')
    await importToDatabase({
      prisma,
      restaurantId: restaurant.id,
      entries: [{ name: 'Chicken 65', categoryName: 'Starters', price: 190, portions: [] }],
    })
    const stillThere = await prisma.foodItem.count({ where: { restaurantId: restaurant.id } })
    check('all 3 dishes still present', stillThere === 3, stillThere)

    /* ----------------------------------- case and spacing are the same dish */
    console.log('\n5. Name normalisation')
    const fifth = await importToDatabase({
      prisma,
      restaurantId: restaurant.id,
      entries: [{ name: '  chicken   65 ', categoryName: 'Starters', price: 190, portions: [] }],
    })
    check('"chicken 65" matched "Chicken 65"', fifth.created.length === 0, fifth.created)
    const finalCount = await prisma.foodItem.count({ where: { restaurantId: restaurant.id } })
    check('no duplicate from spacing or case', finalCount === 3, finalCount)
  } finally {
    await prisma.restaurant.delete({ where: { id: restaurant.id } })
    console.log(`\nCleaned up throwaway restaurant: ${restaurant.slug}`)
    await prisma.$disconnect()
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('\nTest run failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
