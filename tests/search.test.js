// Unit tests for src/search.js — the Berlin-tuned fuzzy place search:
// diacritic/ß/"straße" folding + the multi-tier scorer (exact → prefix →
// word-prefix → substring → subsequence → typo) + type-priority + dedup.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { norm, buildSearchIndex, search } from '../src/search.js'

// ── norm() folding ───────────────────────────────────────────────────────────
test('norm folds case, diacritics, ß and "straße"→"str"', () => {
  assert.equal(norm('Neukölln'), 'neukolln')
  assert.equal(norm('Müllerstraße'), 'mullerstr')
  assert.equal(norm('Schloß'), 'schloss')          // ß→ss, not a "straße"
  assert.equal(norm('Karl-Marx-Straße'), 'karl marx str')
  assert.equal(norm('  A.B/C  '), 'a b c')          // separators → spaces, trimmed
  assert.equal(norm(''), '')
  assert.equal(norm(null), '')
})

// ── a small synthetic index shared by the search tests ───────────────────────
const fc = (features) => ({ type: 'FeatureCollection', features })
const feat = (properties) => ({ type: 'Feature', properties, geometry: null })

buildSearchIndex({
  bez: fc([feat({ bez: '08 - Neukölln' }), feat({ bez: '01 - Mitte' })]),
  bzr: fc([
    feat({ bzr_name: 'Reuterstraße', bez: '08 - Neukölln' }),
    feat({ bzr_name: 'Neuköllner Mitte/Zentrum', bez: '08 - Neukölln' }),
  ]),
  pgr: fc([feat({ pgr_name: 'Neukölln', bez: '08 - Neukölln' })]), // == Bezirk → skipped
  areas: fc([feat({ kiez: 'Reuterkiez', gid: 1 }), feat({ kiez: 'Schillerkiez', gid: 2 })]),
  osmKieze: fc([feat({ name: 'Reuterkiez' })]), // same name as an area → dedup to one
  kieze: fc([
    feat({ gid: 1, bez: '08 - Neukölln', plr_name: 'Reuterkiezplatz', bzr_name: 'Reuterstraße' }),
    feat({ gid: 2, bez: '08 - Neukölln', plr_name: 'Schillerpromenade', bzr_name: 'Schillerpromenade' }),
  ]),
})

test('empty query returns nothing', () => {
  assert.deepEqual(search(''), [])
  assert.deepEqual(search('   '), [])
})

test('exact match ranks first', () => {
  const top = search('Mitte')[0]
  assert.equal(top.label, 'Mitte')
  assert.equal(top.type, 'bez')
})

test('a prefix query surfaces the Bezirk exact-match on top', () => {
  const top = search('Neukölln')[0]
  assert.equal(top.label, 'Neukölln')
  assert.equal(top.type, 'bez')
})

test('type priority breaks ties (Kiez > Bezirksregion > Planungsraum)', () => {
  // "reuter" prefixes Reuterkiez (kiez), Reuterstraße (bzr) and Reuterkiezplatz (plr)
  const top = search('Reuter')[0]
  assert.equal(top.label, 'Reuterkiez')
  assert.equal(top.type, 'kiez')
})

test('duplicate name+type is de-duplicated (OSM Kiez vs merged area)', () => {
  const hits = search('Reuterkiez').filter((r) => r.label === 'Reuterkiez' && r.type === 'kiez')
  assert.equal(hits.length, 1)
})

test('a Prognoseraum equal to its Bezirk is not indexed', () => {
  const pgrHits = search('Neukölln').filter((r) => r.type === 'pgr')
  assert.equal(pgrHits.length, 0)
})

test('search is fold-insensitive (no umlaut / no ß in the query)', () => {
  assert.ok(search('neukolln').some((r) => r.label === 'Neukölln'))
  assert.ok(search('reuterstrasse').some((r) => r.label === 'Reuterstraße'))
})

test('typo tolerance finds a near-miss (bounded Levenshtein)', () => {
  assert.ok(search('Reuterkietz').some((r) => r.label === 'Reuterkiez')) // 1 edit
})

test('search respects the result limit', () => {
  assert.ok(search('e', 3).length <= 3)
})
