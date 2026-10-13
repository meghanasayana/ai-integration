'use strict'

/**
 * Check everything the menu features need, and say which part is broken.
 *
 * Read-only: it counts rows and asks Ollama what it has installed. It writes
 * nothing, changes nothing, and refuses to look at a database that is not
 * local.
 *
 * This exists because the admin login shows "incorrect password" whatever the
 * real cause - including a database that is not running at all - which sent us
 * chasing the wrong problem more than once.
 *
 *   node scripts/doctor.js
 */

require('dotenv').config()

const OK = 'PASS'
const NO = 'FAIL'
const results = []

function report(status, label, detail, fix) {
  results.push({ status, label, detail, fix })
  console.log(`[${status}] ${label}`)
  if (detail) console.log(`       ${detail}`)
  if (status === NO && fix) console.log(`       -> ${fix}`)
}

function databaseHost() {
  const url = process.env.DATABASE_URL || ''
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

async function checkDatabase() {
  const host = databaseHost()

  if (!host) {
    report(NO, 'DATABASE_URL', 'missing or unreadable', 'Check backend/.env')
    return null
  }

  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    report(NO, 'Database target', `points at "${host}", not localhost`,
      'Refusing to continue. Local development must not touch a remote database.')
    return null
  }

  report(OK, 'Database target', `${host} (local, safe)`)

  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const [restaurants, users, categories, dishes] = await Promise.all([
      prisma.restaurant.count(),
      prisma.user.count(),
      prisma.category.count(),
      prisma.foodItem.count(),
    ])
    report(OK, 'Database reachable',
      `${restaurants} restaurant(s), ${users} user(s), ${categories} category(ies), ${dishes} dish(es)`)

    const admin = await prisma.user.findFirst({
      where: { role: 'restaurant_admin' },
      select: { email: true, restaurantId: true },
    })

    if (!admin) {
      report(NO, 'Restaurant admin login', 'no restaurant_admin user exists',
        'node scripts/create-local-restaurant.js')
    } else if (!admin.restaurantId) {
      report(NO, 'Restaurant admin login', `${admin.email} is not linked to a restaurant`,
        'node scripts/create-local-restaurant.js')
    } else {
      report(OK, 'Restaurant admin login', `${admin.email} (password: LocalDev2026!)`)
    }

    return { dishes }
  } catch (error) {
    const dead = /Can't reach database server|ECONNREFUSED/i.test(error.message)
    report(NO, 'Database reachable', dead ? 'nothing listening on that port' : error.message,
      dead
        ? 'docker start renza-dev-db    (then: docker exec renza-dev-db pg_isready -U renza)'
        : 'See the message above')
    return null
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

async function checkOllama() {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const wantedText = process.env.OLLAMA_TEXT_MODEL || '(not set)'
  const wantedVision = process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:4b'

  let installed
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(`${host}/api/tags`, { signal: controller.signal })
      if (!response.ok) {
        report(NO, 'Ollama', `responded ${response.status}`, 'Restart the Ollama app')
        return
      }
      const payload = await response.json()
      installed = (payload.models || []).map((m) => m.name)
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    report(NO, 'Ollama running', error.name === 'AbortError' ? 'no answer in 5s' : error.message,
      'Open the Ollama app, then: ollama ps')
    return
  }

  report(OK, 'Ollama running', `${installed.length} model(s) installed`)

  const has = (name) => installed.some((m) => m === name || m.startsWith(name.split(':')[0] + ':'))

  if (wantedText === '(not set)') {
    report(NO, 'Text model configured', 'OLLAMA_TEXT_MODEL is not set in .env',
      'Add OLLAMA_TEXT_MODEL=qwen2.5:3b - without it, text goes to the slow vision model')
  } else if (!installed.includes(wantedText)) {
    report(NO, 'Text model installed', `${wantedText} is not installed`,
      `ollama pull ${wantedText}`)
  } else {
    report(OK, 'Text model', `${wantedText} (reads PDF rows and menu questions)`)
  }

  if (has(wantedVision)) report(OK, 'Vision model', `${wantedVision} (reads menu photos)`)
  else report(NO, 'Vision model', `${wantedVision} is not installed`, `ollama pull ${wantedVision}`)
}

async function main() {
  console.log('RENZA local development check')
  console.log('=============================\n')

  const db = await checkDatabase()
  console.log('')
  await checkOllama()

  const failed = results.filter((r) => r.status === NO)
  console.log('\n=============================')

  if (failed.length === 0) {
    console.log('Everything needed is working.')
    if (db && db.dishes === 0) {
      console.log('The menu is empty - import a menu, or add a dish, before asking questions about it.')
    }
  } else {
    console.log(`${failed.length} problem(s). Fix them in the order listed above:`)
    for (const f of failed) console.log(`  - ${f.label}: ${f.fix || f.detail}`)
  }

  console.log('\nNothing was changed by this check.')
}

main().catch((error) => {
  console.error('\nThe check itself failed: ' + error.message)
  process.exit(1)
})
