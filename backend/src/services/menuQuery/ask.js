'use strict'

/**
 * Answering a question about the menu.
 *
 * Two routes to a filter, rules first:
 *
 *   rules  Instant, and they already cover the questions people actually ask
 *          about a menu - a price ceiling, a diet, a section, "cheapest".
 *          No model, so no waiting and nothing to time out.
 *
 *   model  Used only when the rules recognise nothing in the question. It
 *          returns a short filter, not a menu, so it stays quick even on a
 *          CPU-only machine.
 *
 * Rules first is not a workaround for the model: a question the rules fully
 * understand gains nothing from being sent to one, and an answer that arrives
 * immediately is a better answer.
 *
 * Either way the database produces every name and price in the reply, and the
 * whole path is read-only.
 */

const { readQuestion, sanitiseFilter, withDefaults } = require('./filter')
const { runQuery } = require('./runQuery')
const { buildAnswer } = require('./answer')
const { buildQuestionPrompt } = require('./prompt')

const MAX_QUESTION_LENGTH = 300

/** Keep the model's reply to a filter; it should be one small JSON object. */
function parseFilterJson(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * @param {object} deps
 * @param {object} deps.prisma
 * @param {string} deps.restaurantId   from the signed-in session only
 * @param {string} deps.question
 * @param {string[]} [deps.categories] the menu's own section names
 * @param {function} [deps.askModel]   ({prompt}) => Promise<{raw}>; omitted in tests
 * @returns {Promise<object>}
 */
async function askMenu({ prisma, restaurantId, question, categories = [], askModel }) {
  const text = String(question || '').trim().slice(0, MAX_QUESTION_LENGTH)

  if (text === '') {
    return { ok: false, code: 'empty_question', message: 'Ask a question about the menu.' }
  }

  const startedAt = Date.now()
  const rules = readQuestion(text, categories)
  let filter = sanitiseFilter(rules.filter)
  let via = 'rules'
  let modelError = null

  if (rules.matched.length === 0) {
    if (!askModel) {
      return {
        ok: false,
        code: 'not_understood',
        message:
          'I could not tell what to look for. Try naming a price, a diet or a section, ' +
          'for example "veg dishes under 200".',
      }
    }

    try {
      const reply = await askModel({ prompt: buildQuestionPrompt(text, categories) })
      filter = sanitiseFilter(parseFilterJson(reply.raw))
      via = 'ai'
    } catch (error) {
      modelError = error.code || 'model_failed'
    }

    if (Object.keys(filter).length === 0) {
      return {
        ok: false,
        code: modelError || 'not_understood',
        message: modelError
          ? 'The local AI did not respond, so I could not read that question. ' +
            'Try naming a price, a diet or a section, for example "veg dishes under 200".'
          : 'I could not tell what to look for. Try naming a price, a diet or a section, ' +
            'for example "veg dishes under 200".',
        via,
      }
    }
  }

  const effective = withDefaults(filter)
  const result = await runQuery(prisma, restaurantId, effective)
  const answer = buildAnswer(result, effective)

  return {
    ok: true,
    via,
    matched: rules.matched,
    filter: effective,
    answer,
    items: result.items,
    total: result.total,
    durationMs: Date.now() - startedAt,
  }
}

module.exports = { askMenu, parseFilterJson, MAX_QUESTION_LENGTH }
