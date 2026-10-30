'use strict'

/**
 * Asking the local model to describe one dish.
 *
 * Two things this prompt has to do at once.
 *
 * It has to produce appetising menu prose - the kind a restaurant actually
 * prints, with the texture and aroma words in it. A flat "a chicken dish
 * fried with spices" is accurate and useless on a menu.
 *
 * And it has to be allowed to refuse. A model given only "Kolshi Prawn" will
 * write a confident sentence about coconut and curry leaves whether or not it
 * knows the dish, and that sentence goes on a menu where someone with an
 * allergy reads it as fact.
 */

const MAX_WORDS = 22

// The house style, in the restaurant's own words. A 3B model copies an
// example far more reliably than it follows an instruction.
const EXAMPLES = [
  ['Gulab Jamun', 'Soft, golden milk-solid dumplings soaked in sweet, aromatic sugar syrup.'],
  ['Biryani', 'Fragrant basmati rice cooked with aromatic spices and rich flavors for a delicious, satisfying meal.'],
  ['Tandoori', 'Tender, marinated pieces roasted in a traditional tandoor for a smoky flavor and delicious charred finish.'],
  ['Fruit Salad', 'A refreshing mix of fresh, juicy seasonal fruits with natural sweetness in every bite.'],
]

function buildDescribePrompt({ name, categoryName }) {
  const section = categoryName ? `\nSection on the menu: "${categoryName}"` : ''

  const examples = EXAMPLES.map(
    ([dish, line]) => `{"known": true, "description": "${line}"}   <- for "${dish}"`,
  ).join('\n')

  return `You write one line for each dish on an Indian restaurant menu.

Dish name: "${name}"${section}

Write in this style:
${examples}

Only describe this dish if you actually know what it is. If the name is
unfamiliar, regional, or particular to one restaurant, and you would have to
guess what is in it, say you do not know. A wrong description misleads a
diner with an allergy, so refusing is the better answer.

Reply with JSON and nothing else:
{"known": true, "description": "..."}  if you are sure what the dish is
{"known": false, "description": ""}    if you are not

The description must:
- be one sentence, at most ${MAX_WORDS} words
- sound appetising, the way a menu does
- mention only ingredients the dish name itself implies
- not start by repeating the dish name
- make no claim about the restaurant, such as famous, award-winning or best`
}

/**
 * Asking for several versions of one dish, for a person to choose between.
 *
 * The single-description call is all or nothing: the model writes one line and
 * if that line runs long, or repeats the dish name, or claims the place is
 * famous, it is thrown away and the dish is left blank. The model usually did
 * know the dish - it just phrased it badly once, and nobody saw what it said.
 *
 * Asking for three gives the admin something to choose from instead of an
 * empty box. Refusing is still allowed and still expected: a model that does
 * not know the dish must say so rather than invent three equally wrong
 * sentences, which would be three times the harm of one.
 */
function buildSuggestPrompt ({ name, categoryName, count = 3 }) {
  const section = categoryName ? `\nSection on the menu: "${categoryName}"` : ''

  const examples = EXAMPLES
    .map(([dish, line]) => `  "${line}"   <- the style used for "${dish}"`)
    .join('\n')

  return `You write lines for an Indian restaurant menu.

Dish name: "${name}"${section}

Write ${count} DIFFERENT one-line descriptions of this dish, each in this style:
${examples}

Rules for every line:
- At most ${MAX_WORDS} words. Shorter is better.
- Describe what arrives on the plate: ingredients, texture, how it is cooked.
- Do not repeat the dish name back as the whole description.
- Never claim the restaurant is famous, award-winning, legendary or the best.
- Do not say you are unsure inside the line.
- Make the ${count} genuinely different from each other, not the same line reworded.

If you do not actually know this dish, do NOT guess. Reply exactly:
{"known": false, "options": []}

Otherwise reply with JSON only:
{"known": true, "options": ["first line", "second line", "third line"]}`
}

module.exports = { buildDescribePrompt, MAX_WORDS, EXAMPLES, buildSuggestPrompt }
