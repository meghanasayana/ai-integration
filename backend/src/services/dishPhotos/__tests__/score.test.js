'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { scoreCandidate, rankCandidates, buildQuery, dishWords } = require('../score')

const photo = (title, tags) => ({ title, tags: tags || [] })

test('a photo whose title names the dish scores well', () => {
  const result = scoreCandidate('Chicken Dum Biryani', photo('Chicken dum biryani in a bowl'))
  assert.ok(result.score >= 0.8, 'score was ' + result.score)
  assert.equal(result.rejected, null)
})

test('a photo of the wrong subject is rejected outright, not ranked last', () => {
  // Real false positives: a drink called "7 Up" matching a lift, a dessert
  // called "Death By Chocolate" matching gravestones and album covers.
  assert.equal(scoreCandidate('7 Up', photo('7 Up elevator button panel')).rejected, 'subject:elevator')
  assert.equal(scoreCandidate('Death By Chocolate', photo('Death by Chocolate album cover')).rejected,
    'subject:album')
  assert.equal(scoreCandidate('Butter Chicken', photo('Restaurant logo design')).rejected, 'subject:logo')

  for (const name of ['7 Up', 'Death By Chocolate', 'Butter Chicken']) {
    const bad = scoreCandidate(name, photo('company logo'))
    assert.equal(bad.score, 0, name + ' must score zero, not merely low')
  }
})

test('a reject word that is part of the dish name does not disqualify it', () => {
  // "Death By Chocolate" is a real dessert. A photo of the dessert must not be
  // thrown out for containing the word the dish is named after.
  const result = scoreCandidate('Death By Chocolate',
    photo('Death by chocolate dessert with ice cream'))
  assert.equal(result.rejected, null)
  assert.ok(result.score >= 0.7, 'score was ' + result.score)
})

test('a photo matching only the common word scores below the threshold', () => {
  // "chicken" matches half a menu, so matching it alone is not a match.
  const result = scoreCandidate('Chicken Kolhapuri', photo('Roast chicken'))
  assert.ok(result.score < 0.5, 'score was ' + result.score)
})

test('a food hint lifts a candidate, and rankCandidates drops the rest', () => {
  const candidates = [
    photo('Masala chai tea in clay cup'),       // good
    photo('Masala chai'),                        // good, less context
    photo('Chai shop signage'),                  // rejected: signage
    photo('Mountain landscape'),                 // no match
  ]

  const ranked = rankCandidates('Masala Chai', candidates)
  assert.equal(ranked.length, 2)
  assert.ok(ranked[0].title.includes('clay cup'), 'the richer food photo should lead')
  assert.ok(ranked.every((c) => c.score >= 0.5))
})

test('rankCandidates returns nothing rather than something wrong', () => {
  // An empty result is a correct answer: no photo beats a wrong photo.
  const ranked = rankCandidates('Thums Up', [
    photo('Thumbs up hand gesture'),
    photo('Man giving thumbs up'),
  ])
  assert.deepEqual(ranked, [], 'a hand gesture is not a soft drink')
})

test('rankCandidates survives junk input', () => {
  for (const junk of [null, undefined, [], [null], [{}]]) {
    assert.deepEqual(rankCandidates('Veg Soup', junk), [])
  }
  assert.deepEqual(rankCandidates('', [photo('anything')]), [])
})

test('dishWords drops portion and filler words', () => {
  assert.deepEqual(dishWords('Half Plate Chicken Biryani with Raita'), ['chicken', 'biryani', 'raita'])
  assert.deepEqual(dishWords('Kareem Nawab SPL Chicken Dum Biryani'),
    ['kareem', 'nawab', 'chicken', 'dum', 'biryani'])
})

test('buildQuery narrows a name that means something else in the world', () => {
  const query = buildQuery('7 Up', 'Bottled Drinks')
  assert.equal(query.primary, '7 up')
  assert.ok(query.fallbacks.some((f) => f.includes('food')),
    'a bare name that is also a common phrase needs a narrowing term')

  assert.equal(buildQuery('', 'Drinks'), null)
})
