'use strict'

/**
 * Fill in the veg / non-veg flag for dishes already in the database.
 *
 * Dishes imported before this existed were all recorded non-vegetarian,
 * because the import never set the flag and the column defaults to false. So
 * cakes, lassi and mojitos all count as non-vegetarian, and a question about
 * non-vegetarian food returns desserts.
 *
 * DRY RUN BY DEFAULT. It prints what it would change and writes nothing.
 * Add --apply to write, and only then.
 *
 *   node scripts/fix-diet.js            see the proposed changes
 *   node scripts/fix-diet.js --apply    write them
 *
 * Refuses to run against anything that is not a local database. Never deletes
 * anything, never touches prices, names, categories or availability.
 */

require('dotenv').config()

const { inferDiet } = require('../src/services/menuImport/dietFromName')

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL || ''
  let host
  try {
    host = new URL(url).hostname
  } catch {
    console.error('DATABASE_URL is missing or unreadable.')
    process.exit(2)
  }

  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error('')
    console.error('  REFUSING TO RUN.')
    console.error(`  DATABASE_URL points at "${host}", not localhost.`)
    console.error('')
    process.exit(2)
  }

  console.log(`Database host: ${host}  (safe)`)
}

async function main() {
  const apply = process.argv.includes('--apply')
  assertLocalDatabase()

  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const dishes = await prisma.foodItem.findMany({
      select: { id: true, name: true, isVeg: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })

    console.log(`${dishes.length} dish(es) in the database\n`)

    const toVeg = []
    const toNonVeg = []
    const leftAlone = []

    for (const dish of dishes) {
      const diet = inferDiet(dish.name, dish.category && dish.category.name)

      if (diet.isVeg === null) {
        leftAlone.push(dish)
        continue
      }
      if (diet.isVeg === dish.isVeg) continue

      const change = { dish, reason: diet.reason }
      if (diet.isVeg) toVeg.push(change)
      else toNonVeg.push(change)
    }

    if (toVeg.length > 0) {
      console.log(`--- would mark VEGETARIAN (${toVeg.length}) ---`)
      for (const { dish, reason } of toVeg) {
        console.log(`  ${dish.name}   [${reason}]`)
      }
      console.log('')
    }

    if (toNonVeg.length > 0) {
      console.log(`--- would mark NON-VEGETARIAN (${toNonVeg.length}) ---`)
      for (const { dish, reason } of toNonVeg) {
        console.log(`  ${dish.name}   [${reason}]`)
      }
      console.log('')
    }

    console.log(`--- left alone, name and section say nothing (${leftAlone.length}) ---`)
    for (const dish of leftAlone.slice(0, 20)) console.log(`  ${dish.name}`)
    if (leftAlone.length > 20) console.log(`  ... and ${leftAlone.length - 20} more`)
    console.log('')

    const total = toVeg.length + toNonVeg.length
    if (total === 0) {
      console.log('Nothing to change.')
      return
    }

    if (!apply) {
      console.log(`DRY RUN. ${total} dish(es) would change. Nothing was written.`)
      console.log('Read the lists above, then re-run with --apply if they look right.')
      return
    }

    let written = 0
    for (const { dish } of [...toVeg, ...toNonVeg]) {
      const diet = inferDiet(dish.name, dish.category && dish.category.name)
      await prisma.foodItem.update({ where: { id: dish.id }, data: { isVeg: diet.isVeg } })
      written += 1
    }

    console.log(`Updated ${written} dish(es). Only the veg flag changed.`)
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

main().catch((error) => {
  console.error('\nFAILED: ' + error.message)
  process.exit(1)
})
