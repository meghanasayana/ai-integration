'use strict'

/**
 * The instruction that turns a question into a filter.
 *
 * Deliberately tiny output. The model returns a short JSON object, roughly
 * thirty tokens, not a menu. On a CPU-only machine that is the difference
 * between a few seconds and a few minutes, because generation cost scales with
 * what is written, not with what is read.
 *
 * The model is also never asked what the menu contains. It only decides what to
 * look for; the database supplies every name and price, so a wrong guess
 * produces an odd search rather than an invented dish.
 */

const INSTRUCTION = `Convert a question about a restaurant menu into a JSON filter.

Return ONLY a JSON object. Use only these keys, and only the ones the question
actually calls for:

  maxPrice      number   "under 250" -> 250
  minPrice      number   "over 300" -> 300
  isVeg         boolean  true for vegetarian, false for non-vegetarian
  isVegan       boolean  true only if the question says vegan
  isJain        boolean
  isGlutenFree  boolean
  maxSpicy      number   0-4, use 1 for "mild" or "not spicy"
  minSpicy      number   0-4, use 2 for "spicy"
  maxCalories   number
  category      string   a menu section name
  nameContains  string   one word from a dish name, e.g. "chicken"
  sort          string   price_asc | price_desc | name | spicy_asc | spicy_desc
  limit         number   1-50

Rules:
- Omit every key the question does not ask for. An empty object {} is correct
  when the question is not about finding dishes.
- "cheapest" means sort price_asc with limit 5. It is NOT a maxPrice.
- "most expensive" means sort price_desc with limit 5.
- Never invent a price the question did not state.
- Do not add any other key. Do not explain. JSON only.

Examples:

Question: what all are vegan
{"isVegan": true}

Question: foods priced under 250
{"maxPrice": 250}

Question: cheapest non veg starters
{"isVeg": false, "category": "Starters", "sort": "price_asc", "limit": 5}

Question: mild paneer dishes between 100 and 200
{"nameContains": "paneer", "minPrice": 100, "maxPrice": 200, "maxSpicy": 1}`

function buildQuestionPrompt(question, categories = []) {
  const sections = categories.slice(0, 25).join(', ')
  const known = sections ? `\n\nMenu sections available: ${sections}` : ''
  return `${INSTRUCTION}${known}

Question: ${String(question || '').slice(0, 300)}`
}

module.exports = { buildQuestionPrompt, INSTRUCTION }
