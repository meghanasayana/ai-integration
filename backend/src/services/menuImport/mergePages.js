'use strict'

/**
 * Merging per-page extraction results.
 *
 * A 12-page menu is read one page at a time rather than in a single request.
 * One request for the whole document means a prompt of several thousand tokens
 * and a reply of several thousand more, which on a CPU-only machine is both
 * very slow and the exact condition that produced an empty response during
 * testing. Per page, each request stays small, a failure costs one page instead
 * of the whole import, and progress can be reported while it runs.
 *
 * That leaves the pages to be stitched back together: a section such as
 * "Biryani" can appear on more than one page, and must end up as one category
 * rather than three.
 */

/** Same category name ignoring case, spacing and punctuation. */
function categoryKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Same dish within a category: used only to drop exact repeats. */
function itemKey(item) {
  const name = categoryKey(item && item.name)
  const price = item && item.price != null ? String(item.price) : ''
  const portions = Array.isArray(item && item.portions)
    ? item.portions.map((p) => `${categoryKey(p.label)}:${p.price}`).join('|')
    : ''
  return `${name}#${price}#${portions}`
}

/**
 * Combine the category lists from several pages into one.
 *
 * Categories keep the order and spelling of their first appearance. Items keep
 * page order. An item identical to one already recorded in the same category is
 * dropped, because a repeat is a page-header artefact rather than a second
 * dish; anything differing in price or portions is kept, so a genuine conflict
 * reaches the review step instead of being silently resolved here.
 *
 * @param {Array<Array<object>>} pageResults  one category list per page
 * @returns {Array<object>} merged category list
 */
function mergeCategories(pageResults) {
  const order = []
  const byKey = new Map()

  for (const categories of pageResults) {
    if (!Array.isArray(categories)) continue

    for (const category of categories) {
      if (!category || !Array.isArray(category.items)) continue

      const key = categoryKey(category.name)
      let target = byKey.get(key)

      if (!target) {
        target = { name: category.name, items: [], seen: new Set() }
        byKey.set(key, target)
        order.push(key)
      }

      for (const item of category.items) {
        if (!item || !item.name) continue
        const fingerprint = itemKey(item)
        if (target.seen.has(fingerprint)) continue
        target.seen.add(fingerprint)
        target.items.push(item)
      }
    }
  }

  return order.map((key) => {
    const entry = byKey.get(key)
    return { name: entry.name, items: entry.items }
  })
}

module.exports = { mergeCategories, categoryKey, itemKey }
