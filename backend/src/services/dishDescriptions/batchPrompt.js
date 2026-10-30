'use strict'

const { MAX_WORDS, EXAMPLES } = require('./prompt')

/**
 * Describing several dishes in one request.
 *
 * Asking per dish means re-sending the style examples and the rules every
 * time - about 250 tokens of prompt for 30 tokens of answer. Ten dishes to a
 * request pays that cost once, which is the difference between a menu taking
 * hours and taking minutes.
 *
 * The reply is keyed by dish name rather than ordered, because a model asked
 * for ten answers will sometimes return nine, and a list that has silently
 * shifted by one puts the wrong description on every dish after it.
 */

const DEFAULT_BATCH = Number(process.env.DESCRIPTION_BATCH_SIZE || 10)

function buildBatchPrompt(dishes) {
  const examples = EXAMPLES.map(
    ([dish, line]) => `  "${dish}": {"known": true, "description": "${line}"}`,
  ).join(',\n')

  const list = dishes
    .map((d) => (d.categoryName ? `- "${d.name}"  (section: ${d.categoryName})` : `- "${d.name}"`))
    .join('\n')

  return `You write one line for each dish on an Indian restaurant menu.

Describe these dishes:
${list}

Write in this style:
{
${examples}
}

Only describe a dish if you actually know what it is. If a name is
unfamiliar, regional, or particular to one restaurant, and you would have to
guess what is in it, mark it not known. A wrong description misleads a diner
with an allergy, so refusing is the better answer for that dish.

Reply with one JSON object and nothing else. Use the dish name exactly as
given above as each key:
{
  "Dish Name": {"known": true, "description": "..."},
  "Other Dish": {"known": false, "description": ""}
}

Every description must:
- be one sentence, at most ${MAX_WORDS} words
- sound appetising, the way a menu does
- mention only ingredients the dish name itself implies
- not start by repeating the dish name
- make no claim about the restaurant, such as famous, award-winning or best

Describe every dish in the list. Do not add dishes that are not listed.`
}

/**
 * Match a batch reply back to the dishes it was asked about.
 *
 * Matching is on a normalised name so that a model which tidies punctuation
 * or capitalisation still lines up, and a dish it simply left out comes back
 * as missing rather than taking another dish's description.
 */
function matchBatchReply(reply, dishes) {
  const byKey = new Map()

  if (reply && typeof reply === 'object') {
    for (const [name, value] of Object.entries(reply)) {
      byKey.set(normaliseKey(name), value)
    }
  }

  return dishes.map((dish) => ({
    dish,
    raw: byKey.get(normaliseKey(dish.name)) ?? null,
  }))
}

const normaliseKey = (name) =>
  String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

module.exports = { buildBatchPrompt, matchBatchReply, normaliseKey, DEFAULT_BATCH }
