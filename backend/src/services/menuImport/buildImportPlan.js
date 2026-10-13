'use strict'

/**
 * Turns validated AI output into a plan the admin can review.
 *
 * This is where the feature's honesty lives. Every entry comes out as
 * either READY (confidently understood) or REVIEW (something needs a
 * human). Nothing is invented: a price that cannot be read stays missing,
 * and two unlabelled prices are never assumed to mean half and full.
 *
 * Produces no database writes and performs no I/O.
 */

const { parsePrice } = require('./price')
const { inferDiet } = require('./dietFromName')
const { normalisePortion, findDuplicatePortions } = require('./portion')
const { normaliseName, isSuspiciouslySimilar } = require('./dishName')

const READY = 'ready'
const REVIEW = 'review'

function buildImportPlan(categories) {
  const entries = []

  for (const category of categories) {
    for (const item of category.items) {
      entries.push(planItem(item, category.name))
    }
  }

  flagDuplicatesWithin(entries)
  flagSimilarNames(entries)

  return {
    entries,
    summary: {
      total: entries.length,
      ready: entries.filter((e) => e.status === READY).length,
      review: entries.filter((e) => e.status === REVIEW).length,
      categories: [...new Set(entries.map((e) => e.categoryName))],
    },
  }
}

function planItem(item, categoryName) {
  const warnings = []

  // The menu gives names and prices, not dietary data, and the database column
  // defaults to false - so without this every imported dish, cakes and lassi
  // included, was recorded as non-vegetarian. Inferred, flagged, and left
  // unset when the name and section say nothing.
  const diet = inferDiet(item.name, categoryName)
  if (diet.isVeg !== null) {
    warnings.push({
      code: 'diet_inferred',
      message:
        (diet.isVeg ? 'Marked vegetarian' : 'Marked non-vegetarian') +
        ' from the name (' + diet.reason + '). Check before saving.',
      blocking: false,
    })
  }

  const entry = {
    isVeg: diet.isVeg,
    dietReason: diet.reason,
    name: item.name.replace(/\s+/g, ' ').trim(),
    normalisedName: normaliseName(item.name),
    categoryName,
    price: null,
    portions: [],
    status: READY,
    warnings,
  }

  const hasPortions = Array.isArray(item.portions) && item.portions.length > 0

  if (hasPortions) {
    planPortions(item, entry, warnings)
  } else if (item.price !== null && item.price !== undefined) {
    planSinglePrice(item, entry, warnings)
  } else {
    // Blocking: FoodItem.price is NOT NULL, so a priceless dish cannot be
    // imported at all. Caught by a test that expected 'review' and got 'ready'.
    warnings.push({
      code: 'no_price',
      message: 'No price could be read for this dish.',
      blocking: true,
    })
  }

  if (warnings.some((w) => w.blocking)) entry.status = REVIEW
  return entry
}

function planSinglePrice(item, entry, warnings) {
  const parsed = parsePrice(item.price)

  if (!parsed.ok) {
    if (parsed.reason === 'multiple_values') {
      // e.g. "110 / 140" with no column headings. Two numbers, no stated
      // meaning. Guessing which is half and which is full would be
      // fabrication, so this is handed to the admin untouched.
      warnings.push({
        code: 'ambiguous_prices',
        message: `Two or more prices were printed without portion labels (read as "${item.price}"). Please say what each price means.`,
        blocking: true,
        rawValue: String(item.price),
      })
      return
    }
    warnings.push({
      code: 'unreadable_price',
      message: `Could not read the price (read as "${item.price}").`,
      blocking: true,
      rawValue: String(item.price),
    })
    return
  }

  entry.price = parsed.value
  for (const code of parsed.warnings) {
    warnings.push({ code, message: describe(code), blocking: code === 'price_is_zero' })
  }
}

function planPortions(item, entry, warnings) {
  const accepted = []

  item.portions.forEach((portion, index) => {
    const position = `portion ${index + 1}`

    const label = normalisePortion(portion.label ?? '')
    const price = parsePrice(portion.price)

    if (!label.ok) {
      warnings.push({
        code: 'portion_without_label',
        message: `A price was found with no portion name (${position}). Please say which portion it is.`,
        blocking: true,
        rawValue: portion.price === null ? null : String(portion.price),
      })
      return
    }

    if (!price.ok) {
      warnings.push({
        code: 'unreadable_portion_price',
        message: `Could not read the price for "${label.label}" (read as "${portion.price}").`,
        blocking: true,
        rawValue: portion.price === null ? null : String(portion.price),
      })
      return
    }

    if (!label.recognised) {
      warnings.push({
        code: 'unusual_portion_name',
        message: `"${label.label}" is not a portion name we recognise. It will be saved exactly as written.`,
        blocking: false,
      })
    }

    for (const code of price.warnings) {
      warnings.push({ code, message: describe(code), blocking: code === 'price_is_zero' })
    }

    accepted.push({ portion: label.label, canonical: label.canonical, price: price.value })
  })

  const duplicates = findDuplicatePortions(accepted.map((p) => p.canonical))
  if (duplicates.length > 0) {
    warnings.push({
      code: 'duplicate_portions',
      message: `The same portion appears more than once (${duplicates.join(', ')}).`,
      blocking: true,
    })
  }

  entry.portions = accepted.map(({ portion, price }) => ({ portion, price }))

  // FoodItem.price is NOT NULL in the schema, so a multi-portion dish still
  // needs a base price. The smallest portion price is used, which is what
  // the customer menu already shows as the "from" price.
  if (accepted.length > 0) {
    entry.price = Math.min(...accepted.map((p) => p.price))
    entry.basePriceDerivedFrom = accepted.find((p) => p.price === entry.price).portion
  }
}

function flagDuplicatesWithin(entries) {
  const byKey = new Map()
  for (const entry of entries) {
    const key = `${entry.categoryName}::${entry.normalisedName}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(entry)
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const entry of group) {
      entry.warnings.push({
        code: 'duplicate_in_upload',
        message: 'This dish appears more than once in the uploaded menu.',
        blocking: true,
      })
      entry.status = REVIEW
    }
  }
}

function flagSimilarNames(entries) {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].normalisedName === entries[j].normalisedName) continue
      if (!isSuspiciouslySimilar(entries[i].name, entries[j].name)) continue

      // A warning only. These are never merged automatically — "Pepper Grill"
      // and "Peri Peri Grill" are different dishes.
      for (const [entry, other] of [[entries[i], entries[j]], [entries[j], entries[i]]]) {
        entry.warnings.push({
          code: 'similar_name',
          message: `Name is very close to "${other.name}". Check these are different dishes.`,
          blocking: false,
        })
      }
    }
  }
}

function describe(code) {
  switch (code) {
    case 'price_is_zero':
      return 'The price was read as zero. Confirm this dish is actually free.'
    case 'price_unusually_high':
      return 'The price is unusually high. Check for a misread digit.'
    default:
      return code
  }
}

module.exports = { buildImportPlan, READY, REVIEW }
