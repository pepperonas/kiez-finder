// Unit tests for src/search.js — the multi-tier SCORER itself, isolated tier by
// tier (exact → prefix → word-prefix → substring → subsequence → bounded typo),
// the type-priority tiebreak, the limit, and further norm() folding edge cases.
// A separate file gets a FRESH module instance (the runner isolates each file in
// its own process), so it owns its own search index without disturbing
// tests/search.test.js. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { norm, buildSearchIndex, search } from '../src/search.js'

// A controlled index: streets (type 'str', prio 1, NOT deduped) let us place one
// name per scorer tier for the SAME query so the ordering reflects tier scores
// alone; a Bezirk + an identically-named street probe the type-priority tiebreak.
const st = (name) => ({ name, bez: 'Testbezirk', pt: [13, 52], bbox: [13, 52, 13, 52] })
const fc = (features) => ({ type: 'FeatureCollection', features })
const feat = (properties) => ({ type: 'Feature', properties, geometry: null })

buildSearchIndex({
  bez: fc([feat({ bez: 'Nord' })]),
  streets: [
    st('Beta'),          // exact         → 1000
    st('Betamax'),       // prefix        → ~877
    st('Ring Betaweg'),  // word-prefix   → ~757  (second word starts with the query)
    st('Zombetazz'),     // substring     → ~583  (query in the middle, no word boundary)
    st('Bqetqa'),        // subsequence   → ~358  (b·e·t·a in order, not contiguous)
    st('Gamma'),         // no match for 'beta'
    st('Nord'),          // same name as the Bezirk → priority tiebreak
    st('Betax'),         // shorter prefix completion than Betamax
  ],
})

// ── the scorer walks the tiers in the documented order ───────────────────────
test('scorer ranks the six match tiers exact > prefix > word-prefix > substring > subsequence', () => {
  const labels = search('beta', 8).filter((h) => h.type === 'str').map((h) => h.label)
  // Beta (exact) first, then the prefixes, then word-prefix, substring, subsequence
  assert.equal(labels[0], 'Beta')
  const betamax = labels.indexOf('Betamax')
  assert.ok(betamax > 0 && betamax < labels.indexOf('Ring Betaweg'), 'prefix beats word-prefix')
  assert.ok(labels.indexOf('Ring Betaweg') < labels.indexOf('Zombetazz'), 'word-prefix beats substring')
  assert.ok(labels.indexOf('Zombetazz') < labels.indexOf('Bqetqa'), 'substring beats subsequence')
  assert.equal(labels.includes('Gamma'), false, 'a non-match is never returned')
})

test('a shorter prefix completion outranks a longer one', () => {
  // both start with "beta"; the closer-to-exact "Betax" wins over "Betamax"
  const labels = search('beta', 8).map((h) => h.label)
  assert.ok(labels.indexOf('Betax') < labels.indexOf('Betamax'))
})

test('type priority breaks an equal (exact) score: a Bezirk beats a same-named street', () => {
  const hits = search('nord', 8)
  assert.equal(hits[0].type, 'bez')          // prio 6 (+18) over street prio 1 (+3)
  assert.ok(hits.some((h) => h.type === 'str' && h.label === 'Nord')) // the street is still there
})

// ── bounded-Levenshtein typo tolerance ───────────────────────────────────────
test('typo tolerance: a 1-edit query (len 4–6) still finds the term', () => {
  assert.ok(search('bet7', 8).some((h) => h.label === 'Beta')) // 1 substitution
})

test('typo tolerance widens to 2 edits only for queries ≥ 7 chars', () => {
  // "betymxx" is 2 edits from the 7-char "Betamax" → matches (max 2 for len ≥ 7)
  const long = search('betymxx', 8)
  assert.ok(long.some((h) => h.label === 'Betamax'), '2-edit typo on a long query matches')
  // "gxmmx" is 2 edits from the 5-char "Gamma" → max is 1 for len < 7 → no match
  assert.equal(search('gxmmx', 8).some((h) => h.label === 'Gamma'), false)
})

test('typo tolerance does not fire for queries shorter than 4 chars', () => {
  // "gxm" (3 chars) is a near-miss of "Gamma" but is neither a prefix/substring
  // nor a subsequence (no 'x' in gamma), and the typo tier requires len ≥ 4 →
  // no match at all, proving the sub-4 guard
  assert.deepEqual(search('gxm', 8), [])
})

test('the typo tier skips words whose length differs by more than the budget', () => {
  // "beta" (4) vs "betamax" (7): |7-4| = 3 > max 1 → never a typo hit here
  const hits = search('beta', 8).map((h) => h.label)
  // Betamax appears only via its PREFIX match, and it must rank below the exact Beta
  assert.ok(hits.indexOf('Beta') < hits.indexOf('Betamax'))
})

// ── limit ─────────────────────────────────────────────────────────────────────
test('search honours the limit and defaults to 8', () => {
  assert.ok(search('beta', 2).length <= 2)
  assert.ok(search('beta').length <= 8) // default
})

test('a query that matches nothing returns an empty array', () => {
  assert.deepEqual(search('zzzzqqqq', 8), [])
})

// ── further norm() folding edge cases ────────────────────────────────────────
test('norm folds every "straße" in a compound, globally', () => {
  assert.equal(norm('Ackerstraße Bergstraße'), 'ackerstr bergstr')
  assert.equal(norm('Straße des 17. Juni'), 'str des 17 juni')
})

test('norm does NOT mangle words that merely start with "stra" (Strausberg)', () => {
  assert.equal(norm('Strausberger Platz'), 'strausberger platz') // no false "straße" fold
  assert.equal(norm('Strandbad'), 'strandbad')
})

test('norm collapses runs of separators and whitespace to single spaces', () => {
  assert.equal(norm('A--B__C//D'), 'a b c d')
  assert.equal(norm('  Karl   Marx  '), 'karl marx')
})
