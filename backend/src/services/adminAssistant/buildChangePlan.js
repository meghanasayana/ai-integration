'use strict'

/**
 * Turns a validated intent into a preview the admin confirms or rejects.
 *
 * Produces a description of what WOULD change. It performs no I/O and
 * returns no database operations — the caller executes only after the admin
 * has confirmed this plan.
 *
 * Every write is `requiresConfirmation: true`. There is no fast path.
 */

const { parsePrice } = require('../menuImport/price')
const { normalisePortion } = require('../menuImport/portion')
const { resolveDish } = require('./resolveDish')

const READY = 'ready'
const NEEDS_CHOICE = 'needs_choice'
const BLOCKED = 'blocked'

/**
 * @param {{action: string, arguments: object, spec: object}} intent
 * @param {{dishes: Array, categories: Array}} context  current menu state
 */
function buildChangePlan(intent, context = {}) {
  const dishes = context.dishes || []
  const categories = context.categories || []

  const plan = {
    action: intent.action,
    summary: intent.spec.describe(intent.arguments),
    changes: [],
    warnings: [],
    candidates: [],
    status: READY,
    requiresConfirmation: intent.spec.writes,
    destructive: intent.spec.destructive,
  }

  switch (intent.action) {
    case 'show_menu':
      return plan

    case 'create_category':
      return planCreateCategory(plan, intent.arguments, categories)

    case 'add_dish':
      return planAddDish(plan, intent.arguments, dishes, categories)

    case 'update_price':
      return planUpdatePrice(plan, intent.arguments, dishes)

    case 'set_availability':
      return planAvailability(plan, intent.arguments, dishes)

    case 'move_dish':
      return planMove(plan, intent.arguments, dishes, categories)

    case 'delete_dish':
      return planDelete(plan, intent.arguments, dishes)

    default:
      return block(plan, 'unsupported', 'That action is not supported.')
  }
}

/* ------------------------------------------------------------ categories */

function planCreateCategory(plan, args, categories) {
  const existing = categories.find(
    (c) => c.name.trim().toLowerCase() === args.categoryName.toLowerCase(),
  )
  if (existing) {
    return block(plan, 'already_exists', `"${existing.name}" already exists.`)
  }
  plan.changes.push({ field: 'category', from: null, to: args.categoryName })
  return plan
}

/* ----------------------------------------------------------------- dishes */

function planAddDish(plan, args, dishes, categories) {
  const clash = dishes.find(
    (d) => d.name.trim().toLowerCase() === args.dishName.toLowerCase(),
  )
  if (clash) {
    return block(
      plan,
      'already_exists',
      `"${clash.name}" is already on the menu. Use "change the price of ${clash.name}" to update it.`,
    )
  }

  if (args.categoryName) {
    const category = findCategory(categories, args.categoryName)
    if (!category) {
      plan.warnings.push({
        code: 'new_category',
        message: `"${args.categoryName}" does not exist yet and will be created.`,
      })
    }
    plan.changes.push({ field: 'category', from: null, to: args.categoryName })
  } else {
    plan.warnings.push({
      code: 'no_category',
      message: 'No category was given. The dish will be uncategorised.',
    })
  }

  if (args.portions && args.portions.length > 0) {
    const portions = []
    for (const portion of args.portions) {
      const label = normalisePortion(portion.label ?? '')
      const price = parsePrice(portion.price)
      if (!label.ok || !price.ok) {
        return block(plan, 'unreadable_portion', 'I could not read one of the portions and prices.')
      }
      portions.push({ portion: label.label, price: price.value })
    }
    plan.changes.push({ field: 'portions', from: null, to: portions })
    plan.changes.push({
      field: 'price',
      from: null,
      to: Math.min(...portions.map((p) => p.price)),
    })
    return plan
  }

  if (args.price === undefined) {
    return block(plan, 'no_price', 'I need a price for the new dish.')
  }

  const price = parsePrice(args.price)
  if (!price.ok) {
    return block(plan, 'unreadable_price', `I could not read "${args.price}" as a price.`)
  }
  carryPriceWarnings(plan, price)
  plan.changes.push({ field: 'price', from: null, to: price.value })
  return plan
}

function planUpdatePrice(plan, args, dishes) {
  const match = requireDish(plan, args.dishName, dishes)
  if (!match) return plan

  const price = parsePrice(args.price)
  if (!price.ok) {
    return block(plan, 'unreadable_price', `I could not read "${args.price}" as a price.`)
  }
  carryPriceWarnings(plan, price)

  if (args.portion) {
    const label = normalisePortion(args.portion)
    if (!label.ok) {
      return block(plan, 'unreadable_portion', `I could not understand the portion "${args.portion}".`)
    }

    const current = (match.portions || []).find(
      (p) => normalisePortion(p.portion).canonical === label.canonical,
    )

    if (!current) {
      const available = (match.portions || []).map((p) => p.portion)
      return block(
        plan,
        'portion_not_found',
        available.length
          ? `"${match.name}" has no ${label.label} portion. It has: ${available.join(', ')}.`
          : `"${match.name}" has no portions, just a single price.`,
      )
    }

    if (Number(current.price) === price.value) {
      plan.warnings.push({ code: 'no_change', message: 'That is already the current price.' })
    }

    plan.changes.push({
      field: `portion:${current.portion}`,
      from: Number(current.price),
      to: price.value,
    })
    return plan
  }

  if ((match.portions || []).length > 0) {
    return block(
      plan,
      'portion_required',
      `"${match.name}" has several portions (${match.portions.map((p) => p.portion).join(', ')}). Which one should change?`,
    )
  }

  if (Number(match.price) === price.value) {
    plan.warnings.push({ code: 'no_change', message: 'That is already the current price.' })
  }

  plan.changes.push({ field: 'price', from: Number(match.price), to: price.value })
  return plan
}

function planAvailability(plan, args, dishes) {
  const match = requireDish(plan, args.dishName, dishes)
  if (!match) return plan

  if (match.isAvailable === args.isAvailable) {
    plan.warnings.push({
      code: 'no_change',
      message: `"${match.name}" is already ${args.isAvailable ? 'available' : 'sold out'}.`,
    })
  }

  plan.changes.push({ field: 'isAvailable', from: match.isAvailable, to: args.isAvailable })
  return plan
}

function planMove(plan, args, dishes, categories) {
  const match = requireDish(plan, args.dishName, dishes)
  if (!match) return plan

  const category = findCategory(categories, args.categoryName)
  if (!category) {
    plan.warnings.push({
      code: 'new_category',
      message: `"${args.categoryName}" does not exist yet and will be created.`,
    })
  }

  plan.changes.push({
    field: 'category',
    from: match.categoryName || null,
    to: category ? category.name : args.categoryName,
  })
  return plan
}

function planDelete(plan, args, dishes) {
  const resolution = resolveDish(args.dishName, dishes)

  // Deletion is irreversible, so a near match is never good enough.
  if (resolution.status !== 'resolved') {
    plan.candidates = resolution.candidates.map(summarise)
    return block(
      plan,
      'exact_match_required',
      resolution.candidates.length
        ? `I will not delete on a close match. Which exactly: ${resolution.candidates.map((d) => d.name).join(', ')}?`
        : `I could not find a dish named "${args.dishName}".`,
    )
  }

  plan.changes.push({ field: 'dish', from: resolution.dish.name, to: null })
  plan.warnings.push({
    code: 'irreversible',
    message: 'Deleting a dish also removes its portions. This cannot be undone.',
  })
  return plan
}

/* ----------------------------------------------------------------- shared */

function requireDish(plan, dishName, dishes) {
  const resolution = resolveDish(dishName, dishes)

  if (resolution.status === 'resolved') return resolution.dish

  plan.candidates = resolution.candidates.map(summarise)

  if (resolution.status === 'ambiguous') {
    plan.status = NEEDS_CHOICE
    plan.requiresConfirmation = true
    plan.warnings.push({
      code: 'ambiguous_dish',
      message: `More than one dish could match "${dishName}". Which did you mean?`,
      blocking: true,
    })
    return null
  }

  block(plan, 'dish_not_found', `I could not find a dish named "${dishName}".`)
  return null
}

function findCategory(categories, name) {
  return categories.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
}

function carryPriceWarnings(plan, price) {
  for (const code of price.warnings || []) {
    plan.warnings.push({ code, message: describePriceWarning(code) })
  }
}

function describePriceWarning(code) {
  if (code === 'price_is_zero') return 'The price is zero. Confirm this dish is free.'
  if (code === 'price_unusually_high') return 'That price is unusually high. Check the digits.'
  return code
}

function summarise(dish) {
  return {
    id: dish.id,
    name: dish.name,
    categoryName: dish.categoryName || null,
    price: dish.price === undefined ? null : Number(dish.price),
  }
}

function block(plan, code, message) {
  plan.status = BLOCKED
  plan.warnings.push({ code, message, blocking: true })
  return plan
}

module.exports = { buildChangePlan, READY, NEEDS_CHOICE, BLOCKED }
