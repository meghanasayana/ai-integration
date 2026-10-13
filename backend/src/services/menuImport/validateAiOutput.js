'use strict'

/**
 * Structural validation of whatever the AI returns.
 *
 * This runs before any interpretation. Its only job is to answer:
 * "is this the shape we asked for?" A model can return prose, truncated
 * JSON, or an object with the right keys and wrong types. All of that is
 * rejected here rather than being half-understood downstream.
 *
 * Hand-written rather than using a schema library: the backend has no
 * validation dependency today and this feature should not be the reason
 * to add one.
 *
 * Expected shape:
 *   {
 *     "categories": [
 *       { "name": "Starters",
 *         "items": [
 *           { "name": "Chicken 65", "price": "190" },
 *           { "name": "Grill Chicken",
 *             "portions": [ { "label": "Quarter", "price": "140" } ] }
 *         ] }
 *     ]
 *   }
 */

const MAX_CATEGORIES = 100
const MAX_ITEMS_PER_CATEGORY = 500
const MAX_PORTIONS_PER_ITEM = 12
const MAX_NAME_LENGTH = 200

function validateAiOutput(raw) {
  const errors = []

  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      return { ok: false, errors: ['Model did not return valid JSON.'] }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['Expected a JSON object at the top level.'] }
  }

  if (!Array.isArray(parsed.categories)) {
    return { ok: false, errors: ['Missing "categories" array.'] }
  }

  if (parsed.categories.length === 0) {
    return { ok: false, errors: ['No categories found in the document.'] }
  }

  if (parsed.categories.length > MAX_CATEGORIES) {
    return { ok: false, errors: [`Too many categories (${parsed.categories.length}).`] }
  }

  const categories = []

  parsed.categories.forEach((category, categoryIndex) => {
    const where = `categories[${categoryIndex}]`

    if (!category || typeof category !== 'object') {
      errors.push(`${where} is not an object.`)
      return
    }

    const name = typeof category.name === 'string' ? category.name.trim() : ''
    if (!name) {
      errors.push(`${where}.name is missing or empty.`)
      return
    }
    if (name.length > MAX_NAME_LENGTH) {
      errors.push(`${where}.name is unreasonably long.`)
      return
    }

    if (!Array.isArray(category.items)) {
      errors.push(`${where}.items is missing or not an array.`)
      return
    }
    if (category.items.length > MAX_ITEMS_PER_CATEGORY) {
      errors.push(`${where}.items has too many entries.`)
      return
    }

    const items = []

    category.items.forEach((item, itemIndex) => {
      const itemWhere = `${where}.items[${itemIndex}]`

      if (!item || typeof item !== 'object') {
        errors.push(`${itemWhere} is not an object.`)
        return
      }

      const itemName = typeof item.name === 'string' ? item.name.trim() : ''
      if (!itemName) {
        errors.push(`${itemWhere}.name is missing or empty.`)
        return
      }
      if (itemName.length > MAX_NAME_LENGTH) {
        errors.push(`${itemWhere}.name is unreasonably long.`)
        return
      }

      const hasPrice = item.price !== undefined && item.price !== null && item.price !== ''
      const hasPortions = Array.isArray(item.portions) && item.portions.length > 0

      if (!hasPrice && !hasPortions) {
        // Not a structural failure — a dish with no readable price is a
        // review case, handled later. Carried through so the admin sees it.
        items.push({ name: itemName, price: null, portions: [] })
        return
      }

      const portions = []
      if (hasPortions) {
        if (item.portions.length > MAX_PORTIONS_PER_ITEM) {
          errors.push(`${itemWhere}.portions has too many entries.`)
          return
        }
        item.portions.forEach((portion, portionIndex) => {
          if (!portion || typeof portion !== 'object') {
            errors.push(`${itemWhere}.portions[${portionIndex}] is not an object.`)
            return
          }
          portions.push({
            label: typeof portion.label === 'string' ? portion.label : null,
            price: portion.price === undefined ? null : portion.price,
          })
        })
      }

      items.push({
        name: itemName,
        price: hasPrice ? item.price : null,
        portions,
      })
    })

    categories.push({ name, items })
  })

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const totalItems = categories.reduce((sum, c) => sum + c.items.length, 0)
  if (totalItems === 0) {
    return { ok: false, errors: ['No menu items found in the document.'] }
  }

  return { ok: true, categories, errors: [] }
}

module.exports = { validateAiOutput }
