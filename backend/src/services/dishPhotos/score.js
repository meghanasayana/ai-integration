'use strict'

/**
 * Deciding whether a found photo actually shows the dish.
 *
 * An image search for a dish name returns whatever matched the words, which is
 * not the same as a picture of the food. "Death By Chocolate" returns album
 * covers; "7 Up" returns a lift. Attaching those to a menu is worse than
 * leaving the dish without a photo, because a diner orders from the picture.
 *
 * So a candidate has to earn its place: the words of the dish name must appear
 * in the photo's own title or tags, the obviously-wrong subjects are rejected
 * outright, and anything that does not clear a threshold is dropped rather
 * than ranked last. An empty result is a correct answer here.
 *
 * No model is involved. This is word overlap and a reject list, which is both
 * instant and inspectable - and on a CPU-only machine, instant matters.
 */

/** Words that carry no meaning for matching a dish. */
const STOP_WORDS = new Set([
  'with', 'and', 'the', 'in', 'of', 'a', 'an', 'spl', 'special', 'our',
  'house', 'style', 'fresh', 'hot', 'cold', 'served', 'piece', 'pieces',
  'pcs', 'pc', 'plate', 'full', 'half', 'quarter', 'small', 'medium', 'large',
  'regular', 'combo', 'veg', 'nonveg',
])

/**
 * Subjects that mean the photo is not food, however well the words matched.
 * Drawn from real false positives: a drink called "7 Up" matching a lift, a
 * dessert called "Death By Chocolate" matching gravestones and album art.
 */
const REJECT_WORDS = [
  'logo', 'poster', 'album', 'cover art', 'book', 'magazine', 'advertisement',
  'billboard', 'signage', 'shop front', 'storefront', 'menu card',
  'elevator', 'lift', 'escalator', 'staircase',
  'grave', 'gravestone', 'cemetery', 'funeral', 'skull', 'death',
  'portrait', 'wedding', 'protest', 'map', 'diagram', 'chart',
  'car', 'bike', 'motorcycle', 'aircraft', 'building', 'church', 'temple',
  'nude', 'bikini', 'lingerie',
]

/** Words that suggest the photo really is of food. */
const FOOD_HINTS = [
  'food', 'dish', 'cuisine', 'meal', 'plate', 'bowl', 'curry', 'rice',
  'chicken', 'mutton', 'paneer', 'biryani', 'dessert', 'sweet', 'cake',
  'ice cream', 'drink', 'beverage', 'juice', 'shake', 'coffee', 'tea',
  'lassi', 'soup', 'starter', 'snack', 'restaurant', 'kitchen', 'cooking',
  'breakfast', 'lunch', 'dinner', 'tandoori', 'grill', 'fried', 'roast',
]

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '' && !STOP_WORDS.has(w))
}

/**
 * The words of a dish name worth searching for.
 *
 * A single digit counts: "7 Up" is mostly the "7", and dropping it left the
 * search looking for "up", which matches nothing useful.
 */
function dishWords(name) {
  return words(name).filter((w) => w.length >= 2 || /\d/.test(w))
}

/** Everything a candidate says about itself, as one lowercase string. */
function candidateText(candidate) {
  // A null or non-object entry must not take the request down with it: these
  // lists come from a remote service and are not ours to trust.
  if (!candidate || typeof candidate !== 'object') return ''

  const parts = [candidate.title, candidate.description]
  if (Array.isArray(candidate.tags)) {
    for (const tag of candidate.tags) {
      parts.push(typeof tag === 'string' ? tag : tag && tag.name)
    }
  }
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/**
 * Score a candidate from 0 to 1, with a reason.
 *
 * @returns {{score: number, matched: string[], rejected: string|null}}
 */
function scoreCandidate(dishName, candidate) {
  const wanted = dishWords(dishName)
  const text = candidateText(candidate)

  if (wanted.length === 0) return { score: 0, matched: [], rejected: 'no_dish_words' }
  if (text.trim() === '') return { score: 0, matched: [], rejected: 'no_description' }

  // A wrong subject disqualifies the photo no matter how the words scored.
  for (const bad of REJECT_WORDS) {
    if (text.includes(bad) && !wanted.includes(bad)) {
      return { score: 0, matched: [], rejected: 'subject:' + bad }
    }
  }

  const matched = wanted.filter((word) => text.includes(word))
  let score = matched.length / wanted.length

  // A photo that says it is food is more likely to be the dish.
  if (FOOD_HINTS.some((hint) => text.includes(hint))) score += 0.15

  // The most distinctive word carries the most meaning: "biryani" matching is
  // worth more than "chicken", which matches half a menu.
  const longest = wanted.slice().sort((a, b) => b.length - a.length)[0]
  if (longest && longest.length >= 5 && !matched.includes(longest)) score -= 0.25

  return { score: Math.max(0, Math.min(1, score)), matched, rejected: null }
}

/** Below this, a candidate is dropped rather than offered. */
const MIN_SCORE = 0.5

/**
 * Rank candidates, keeping only those that plausibly show the dish.
 * Returns an empty array when nothing qualifies, which is a valid answer.
 */
function rankCandidates(dishName, candidates, options = {}) {
  const minScore = options.minScore != null ? options.minScore : MIN_SCORE
  const limit = options.limit || 6

  return (candidates || [])
    .filter((candidate) => candidate && typeof candidate === 'object')
    .map((candidate) => {
      const scored = scoreCandidate(dishName, candidate)
      return { ...candidate, score: scored.score, matched: scored.matched, rejected: scored.rejected }
    })
    .filter((candidate) => candidate.rejected === null && candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * The search terms for a dish. Adding "food" narrows a name that means
 * something else in the wider world, which is most of the false positives.
 */
function buildQuery(dishName, categoryName) {
  const wanted = dishWords(dishName)
  if (wanted.length === 0) return null

  const terms = wanted.slice(0, 4)
  const category = categoryName ? dishWords(categoryName).slice(0, 1) : []

  return {
    primary: terms.join(' '),
    // Tried in order; the first that returns something usable wins.
    fallbacks: [
      terms.join(' ') + ' food',
      [...terms.slice(0, 2), ...category].join(' ') + ' food',
      terms.slice(0, 2).join(' ') + ' indian food',
    ],
  }
}

module.exports = {
  scoreCandidate,
  rankCandidates,
  buildQuery,
  dishWords,
  candidateText,
  MIN_SCORE,
  REJECT_WORDS,
  FOOD_HINTS,
}
