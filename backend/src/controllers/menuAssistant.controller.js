'use strict'

/**
 * Menu assistant endpoint.
 *
 *   POST /restaurant/menu-assistant/ask   question -> answer
 *
 * READ ONLY by construction. It calls the menuQuery service, which contains no
 * create, update, delete or raw query, so no phrasing of a question can change
 * the menu. The restaurant comes from the signed-in session, never from the
 * request body, so a question cannot reach another restaurant's data.
 *
 * Every dish name and price in the reply is read from the database. The model,
 * when it is used at all, only decides what to search for.
 */

const prisma = require('../lib/prisma')
const { askMenu } = require('../services/menuQuery/ask')
const { generateFilter, OllamaError } = require('../services/menuImport/ollama')

/** POST /api/restaurant/menu-assistant/ask */
const ask = async (req, res) => {
  const restaurantId = req.user && req.user.restaurantId
  if (!restaurantId) {
    return res.status(403).json({ error: 'This account is not linked to a restaurant.' })
  }

  const question = req.body && req.body.question
  if (typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: 'Ask a question about the menu.' })
  }

  // The menu's own section names, so a question naming a real section filters
  // by it rather than by dish name.
  const categories = await prisma.category.findMany({
    where: { restaurantId },
    select: { name: true },
    orderBy: { sortOrder: 'asc' },
  })

  let result
  try {
    result = await askMenu({
      prisma,
      restaurantId,
      question,
      categories: categories.map((c) => c.name),
      askModel: generateFilter,
    })
  } catch (error) {
    if (error instanceof OllamaError) {
      return res.status(503).json({ error: error.message, code: error.code })
    }
    console.error('[menu-assistant] failed:', error.message)
    return res.status(500).json({ error: 'The question could not be answered.' })
  }

  if (!result.ok) {
    // 422: understood as a request, but not answerable as asked.
    return res.status(422).json({ error: result.message, code: result.code, via: result.via })
  }

  return res.json({
    answer: result.answer,
    // The matching dishes themselves, so the page can show real cards. Every
    // field here was read from the database; none of it came from the model.
    items: result.items,
    // Returned so the screen can show what was searched for. An answer whose
    // filter is visible can be checked; one that just asserts cannot.
    filter: result.filter,
    via: result.via,
    matched: result.matched,
    durationMs: result.durationMs,
  })
}

module.exports = { ask }
