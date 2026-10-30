'use strict'

const { MAX_WORDS } = require('./prompt')

/**
 * Deciding whether what the model returned is fit to put on a menu.
 *
 * Kept apart from the call so it can be tested without a model running, and
 * because this is where the judgement lives: everything here is a reason to
 * throw a description away rather than print it.
 */

/**
 * Words that make a claim about the restaurant rather than describe the food.
 *
 * This list used to hold "delicious", "succulent" and the rest, and it was
 * wrong: those are exactly the words a menu uses, and the restaurant's own
 * house style is full of them. What a menu should not do is assert that a
 * dish is famous or award-winning, because that is a claim about the place
 * and not a description of what arrives on the plate.
 */
const SALES_WORDS = [
  'famous', 'world famous', 'award-winning', 'award winning',
  'number one', 'the best in', 'voted best', 'legendary',
]

const MAX_CHARS = 200

const words = (text) => String(text).trim().split(/\s+/).filter(Boolean)

/**
 * @returns {{ok: true, description: string} | {ok: false, reason: string}}
 */
function validateDescription(raw, dishName) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'no reply' }
  }

  // The model saying it does not know is a correct answer, not a failure.
  if (raw.known !== true) {
    return { ok: false, reason: 'not known' }
  }

  const description = String(raw.description ?? '').trim().replace(/\s+/g, ' ')

  if (!description) return { ok: false, reason: 'empty' }
  if (description.length > MAX_CHARS) return { ok: false, reason: 'too long' }
  if (words(description).length > MAX_WORDS) return { ok: false, reason: 'too long' }

  const lower = description.toLowerCase()

  // A description that is just the dish name adds nothing.
  const name = String(dishName ?? '').trim().toLowerCase()
  if (name && (lower === name || lower === `${name}.`)) {
    return { ok: false, reason: 'repeats the name' }
  }

  for (const word of SALES_WORDS) {
    if (lower.includes(word)) return { ok: false, reason: `sales word: ${word}` }
  }

  // A model that is unsure often says so inside the sentence instead of
  // setting known to false.
  if (/\b(i (do not|don't) know|not sure|unclear|unknown|cannot determine|as an ai)\b/.test(lower)) {
    return { ok: false, reason: 'hedged' }
  }

  return { ok: true, description }
}

module.exports = { validateDescription, SALES_WORDS, MAX_CHARS }
