#!/usr/bin/env node
'use strict'

/**
 * Creates a restaurant and a restaurant-admin login in the LOCAL dev database,
 * so the admin site can be used without running the super-admin app.
 *
 *   node scripts/create-local-restaurant.js
 *
 * Refuses to run against anything that is not localhost. Safe to re-run:
 * it updates the same account rather than creating duplicates.
 */

require('dotenv').config()

const bcrypt = require('bcryptjs')
const prisma = require('../src/lib/prisma')

const NAME = process.argv[2] || 'Anbude Cafe'
const SLUG = process.argv[3] || 'anbude-cafe'
const EMAIL = (process.argv[4] || 'owner@renza.local').toLowerCase()
const PASSWORD = process.argv[5] || 'LocalDev2026!'

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
    console.error('')
    process.exit(2)
  }
  console.log(`Database host: ${host}  (safe)\n`)
}

async function main() {
  assertLocalDatabase()

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: SLUG },
    update: { name: NAME },
    create: { name: NAME, slug: SLUG },
    select: { id: true, name: true, slug: true },
  })

  const passwordHash = await bcrypt.hash(PASSWORD, 12)

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, name: `${NAME} Admin`, role: 'restaurant_admin', restaurantId: restaurant.id },
    create: {
      email: EMAIL,
      passwordHash,
      name: `${NAME} Admin`,
      role: 'restaurant_admin',
      restaurantId: restaurant.id,
    },
    select: { email: true, role: true },
  })

  console.log('----------------------------------------------------------')
  console.log('  RESTAURANT ADMIN READY (local database only)')
  console.log(`  Restaurant : ${restaurant.name}  (/${restaurant.slug})`)
  console.log(`  Email      : ${user.email}`)
  console.log(`  Password   : ${PASSWORD}`)
  console.log(`  Role       : ${user.role}`)
  console.log('----------------------------------------------------------')
  console.log(`\n  Admin site     : http://localhost:3001/login`)
  console.log(`  Customer menu  : http://localhost:3003/menu/${restaurant.slug}`)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
