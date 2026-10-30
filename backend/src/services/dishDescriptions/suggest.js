'use strict'

const { ask } = require('./provider')
const { buildSuggestPrompt } = require('./prompt')
const { validateDescription, SALES_WORDS } = require('./validate')
const { lookup, splitName } = require('./library')

/**
 * Offering a choice for a dish that was left blank.
 *
 * The automatic pass is all or nothing. It asks for one line, and if that line
 * runs long or phrases itself badly it is thrown away and the dish stays
 * empty - so the admin sees "left blank" for a dish the model knew perfectly
 * well and simply described in twenty-four words instead of twenty-two.
 *
 * This asks for three and hands all three over to be chosen between, each
 * marked with whatever is wrong with it. Nothing is hidden on the admin's
 * behalf: they are the one who knows the dish, and a line that is four words
 * too long is theirs to shorten or accept.
 *
 * What is NOT offered is a guess. If the model says it does not know the
 * dish, this returns nothing and says so, because three invented sentences
 * are three times the harm of one.
 */

const MAX_OPTIONS = 3

/**
 * Why this line is not quite house style, in words an admin can act on.
 *
 * `validateDescription` answers with a reason code aimed at a log. The same
 * judgement is wanted here, but said out loud and attached to the line rather
 * than used to delete it.
 */
function noteOn (text, dishName) {
  const verdict = validateDescription({ known: true, description: text }, dishName)
  if (verdict.ok) return null

  switch (verdict.reason) {
    case 'too long':
      return 'Longer than the house style — trim it or use it as it is.'
    case 'repeats the name':
      return 'Says little more than the dish name.'
    default:
      break
  }

  if (verdict.reason.startsWith('sales word')) {
    const word = verdict.reason.slice('sales word: '.length)
    return `Claims the restaurant is "${word}" rather than describing the food.`
  }

  if (verdict.reason === 'hedged') return 'The model is unsure of this one.'
  return 'Not quite house style.'
}

/** Lines that say the same thing twice are one option, not two. */
function distinct (lines) {
  const seen = new Set()
  const out = []

  for (const line of lines) {
    const key = String(line).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(String(line).trim().replace(/\s+/g, ' '))
  }

  return out
}

const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Something to start from when the model does not know the dish at all.
 *
 * This is the case that matters most and the one that was still an empty box:
 * the AI refuses, correctly, and the admin is left with nothing. But "Kolshi
 * Prawn" is not nothing - whatever kolshi turns out to mean, it is a prawn
 * dish, and the name says so.
 *
 * So these lines are built ONLY from what the name and the menu section
 * actually state. No texture, no spices, no cooking method is invented, and
 * that is the whole point: a vague line the admin sharpens is honest, while
 * "simmered in coconut gravy with curry leaves" is a sentence somebody with
 * an allergy would read as fact. Every one is marked generic so nobody
 * mistakes it for the AI knowing the dish.
 */
function fallbackOptions ({ name, categoryName }) {
  const dish = String(name || '').trim()
  const { ingredient, preparation } = splitName(dish)
  const lines = []

  // What the name itself says, and only that. "Eeral Varuval" is goat liver,
  // dry-fried; the library knows both words even when it has no template that
  // joins them, so say what is known and leave the rest to the person.
  if (ingredient && preparation) {
    lines.push(sentence(`${ingredient}, ${preparation} style.`))
    lines.push(sentence(`${ingredient} prepared ${preparation}.`))
  } else if (ingredient) {
    lines.push(sentence(`${ingredient}, cooked South Indian style.`))
  }

  return distinct(lines).slice(0, MAX_OPTIONS).map((text) => ({
    text,
    generic: true,
    note: 'Only what the dish name itself says — fill in the rest.',
  }))
}

/**
 * Three ways of describing one dish, for a person to pick from.
 *
 * @param {{name: string, categoryName?: string}} dish
 * @returns {Promise<{known: boolean, options: {text: string, note: string|null}[]}>}
 */
async function suggestFor (dish) {
  const name = String(dish && dish.name ? dish.name : '').trim()
  if (name === '') return { known: false, options: [] }

  const options = []

  // The library knows a few hundred dishes outright and costs nothing to ask,
  // so its line goes in first and the model fills the rest. It is house style
  // by construction, so it never carries a note.
  const known = lookup(name)
  if (known) options.push({ text: known, note: null })

  let reply
  try {
    reply = await ask(buildSuggestPrompt({ name, categoryName: dish.categoryName, count: MAX_OPTIONS }))
  } catch (err) {
    // The service, not the dish. Whatever the library had still stands.
    if (options.length > 0) return { known: true, options }
    throw err
  }

  const offered = reply && Array.isArray(reply.options) ? reply.options : []

  // A refusal is an answer. Only an empty list AND a refusal means nothing.
  if (reply && reply.known === true) {
    for (const line of distinct(offered)) {
      if (options.some((o) => o.text.toLowerCase() === line.toLowerCase())) continue
      options.push({ text: line, note: noteOn(line, name) })
      if (options.length >= MAX_OPTIONS + (known ? 1 : 0)) break
    }
  }

  // The model refused and the library had nothing. Rather than an empty box,
  // offer what the name itself supports and say plainly that is all it is.
  if (options.length === 0) {
    return { known: false, options: fallbackOptions({ name, categoryName: dish.categoryName }) }
  }

  return { known: true, options }
}

module.exports = { suggestFor, fallbackOptions, noteOn, distinct, MAX_OPTIONS, SALES_WORDS }
