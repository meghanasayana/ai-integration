'use strict'

/**
 * Structural validation of the assistant's output.
 *
 * Mirrors menuImport/validateAiOutput.js: shape only, no interpretation.
 * An action outside the catalogue, a missing required argument, or an
 * argument of the wrong type is rejected here — never partially understood
 * and never passed on to something that can write.
 *
 * Expected shape:
 *   { "action": "update_price",
 *     "arguments": { "dishName": "Grill Chicken", "price": "240",
 *                    "portion": "Half" } }
 */

const { COMMANDS, ACTION_NAMES } = require('./commands')

const MAX_STRING = 200

function validateIntent(raw) {
  let parsed = raw

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, code: 'not_json', message: 'The assistant did not return valid JSON.' }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'not_an_object', message: 'Expected a JSON object.' }
  }

  const action = typeof parsed.action === 'string' ? parsed.action.trim() : ''

  if (!action) {
    return { ok: false, code: 'no_action', message: 'No action was given.' }
  }

  // An unrecognised action is not executed and not guessed at.
  if (!ACTION_NAMES.includes(action)) {
    return {
      ok: false,
      code: 'unknown_action',
      message: `I can't do "${action}". I can show the menu, add dishes, change prices, mark items available or sold out, move dishes between categories, create categories, and delete dishes.`,
    }
  }

  const spec = COMMANDS[action]
  const given = parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {}
  const args = {}
  const missing = []

  for (const field of [...spec.required, ...spec.optional]) {
    const value = given[field]
    const present = value !== undefined && value !== null && value !== ''

    if (!present) {
      if (spec.required.includes(field)) missing.push(field)
      continue
    }

    const checked = coerce(field, value)
    if (checked.ok) {
      args[field] = checked.value
    } else if (spec.required.includes(field)) {
      return { ok: false, code: 'bad_argument', message: checked.message }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing_arguments',
      message: `I need more detail: ${missing.map(human).join(' and ')}.`,
      missing,
    }
  }

  // Arguments the catalogue does not define are dropped, not passed through.
  return { ok: true, action, arguments: args, spec }
}

function coerce(field, value) {
  switch (field) {
    case 'isAvailable':
      if (typeof value === 'boolean') return { ok: true, value }
      if (value === 'true') return { ok: true, value: true }
      if (value === 'false') return { ok: true, value: false }
      return { ok: false, message: 'Availability must be true or false.' }

    case 'portions':
      if (!Array.isArray(value)) return { ok: false, message: 'Portions must be a list.' }
      return {
        ok: true,
        value: value
          .filter((p) => p && typeof p === 'object')
          .map((p) => ({
            label: typeof p.label === 'string' ? p.label : null,
            price: p.price === undefined ? null : p.price,
          })),
      }

    case 'price':
      // Left as written; parsed and range-checked in buildChangePlan.
      if (typeof value === 'number' || typeof value === 'string') return { ok: true, value }
      return { ok: false, message: 'The price was not readable.' }

    default: {
      if (typeof value !== 'string') return { ok: false, message: `"${field}" must be text.` }
      const trimmed = value.trim().replace(/\s+/g, ' ')
      if (!trimmed) return { ok: false, message: `"${field}" was empty.` }
      if (trimmed.length > MAX_STRING) return { ok: false, message: `"${field}" is too long.` }
      return { ok: true, value: trimmed }
    }
  }
}

function human(field) {
  const names = {
    dishName: 'which dish',
    categoryName: 'which category',
    price: 'the new price',
    isAvailable: 'available or sold out',
  }
  return names[field] || field
}

module.exports = { validateIntent }
