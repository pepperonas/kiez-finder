// Unit tests for the data loaders + loaded-state logic in src/kiez.js.
//
// The loaders fetch from /data/* — here global.fetch is replaced with a mock
// serving synthetic fixtures (tests/loaders-fixtures.mjs), so we can exercise:
// memoisation, the documented fail→reset→retry semantics of loadWall/
// loadStreets, and the state-dependent pure functions (findKiez, findOsmKiez,
// kiezAreaFor, featureForLevel) that tests/kiez.test.js cannot reach (they
// need loaded module state).
//
// Module-state isolation: src/kiez.js keeps its data in module-level vars, and
// the happy path here fills them. The failure/fallback scenarios need a FRESH
// instance and live in tests/loaders-fallback.test.js — the test runner runs
// each file in its own process, so module state never leaks between the two
// (and coverage still merges per file path, unlike query-string imports which
// would split src/kiez.js into one report row per instance).
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadKieze, loadLevels, loadOutline, loadKiezNames, loadWall, loadStreets,
  kiezeFC, kiezAreasFC, osmKiezeFC, levelFC,
  findKiez, findOsmKiez, kiezAreaFor, featureForLevel, bboxOf,
} from '../src/kiez.js'
import { PLR_A, PLR_B, PLR_TRI, STREETS, mockFetch, serveAll } from './loaders-fixtures.mjs'

const m = mockFetch()
serveAll(m)
// wall + streets start BROKEN — the retry suites below prove the reset semantics
m.failUrl('/data/mauer.geojson')
m.failUrl('/data/strassen.json')
test.after(() => m.restore())

// ── loadWall / loadStreets: fail → promise reset → retry succeeds ────────────
test('loadWall: a failed load resets the promise so a retry can succeed', async () => {
  await assert.rejects(loadWall(), /500/)
  m.serve('/data/mauer.geojson', (await import('./loaders-fixtures.mjs')).WALL) // "network is back"
  const wall = await loadWall()
  assert.equal(wall.wall.features[0].properties.typ, 'mauer')
  assert.equal(wall.west.properties.side, 'west') // unwrapped to the bare feature
  assert.equal(wall.ost.properties.side, 'ost')
})

test('loadWall memoises after success (no extra fetches)', async () => {
  const n = m.countFor('/data/mauer.geojson')
  await loadWall()
  await loadWall()
  assert.equal(m.countFor('/data/mauer.geojson'), n)
})

test('loadStreets: fail → reset → retry, then decodes the compact format', async () => {
  await assert.rejects(loadStreets(), /500/)
  m.serve('/data/strassen.json', STREETS)
  const streets = await loadStreets()
  assert.equal(streets.length, 2)
  assert.deepEqual(streets[0], {
    name: 'Teststraße', bez: 'Neukölln', pt: [13.1, 52.1], bbox: [13.0, 52.0, 13.2, 52.2],
  })
  assert.equal(streets[1].bez, '') // bezIdx out of range → boundary-street fallback
})

// ── loadKieze: memoisation + accessor wiring ─────────────────────────────────
test('loadKieze loads once and memoises (second call = no fetch)', async () => {
  const a = await loadKieze()
  const n = m.countFor('/data/kieze.geojson')
  const b = await loadKieze()
  assert.equal(a, b)
  assert.equal(m.countFor('/data/kieze.geojson'), n)
  assert.equal(kiezeFC(), a)
  assert.equal(kiezAreasFC().features.length, 1)
  assert.equal(osmKiezeFC().features.length, 2)
})

// ── findKiez against loaded state ────────────────────────────────────────────
test('findKiez: hit, miss, and bbox-hit-but-geometry-miss', () => {
  assert.equal(findKiez(13.1, 52.1).properties.plr_name, 'Testfeld West')
  assert.equal(findKiez(13.3, 52.1).properties.plr_name, 'Testfeld Ost')
  assert.equal(findKiez(10.0, 50.0), null)      // far outside every bbox
  assert.equal(findKiez(13.79, 52.79), null)    // inside triangle bbox, outside triangle
  assert.equal(findKiez(13.65, 52.65).properties.plr_name, 'Dreieck')
})

// ── findOsmKiez: smallest-bbox nesting ───────────────────────────────────────
test('findOsmKiez prefers the finest (smallest-bbox) containing polygon', () => {
  // inside BOTH Groß and the nested Klein → Klein wins (Scheunenviertel case)
  assert.equal(findOsmKiez(13.07, 52.07).properties.name, 'Viertel Klein')
  // inside Groß only
  assert.equal(findOsmKiez(13.15, 52.15).properties.name, 'Viertel Groß')
  // outside every OSM Kiez (but inside PLR_B) → null
  assert.equal(findOsmKiez(13.3, 52.1), null)
})

// ── kiezAreaFor: merged group vs fallback ────────────────────────────────────
test('kiezAreaFor returns the merged colloquial area for a grouped Planungsraum', () => {
  const area = kiezAreaFor(PLR_A)
  assert.equal(area.properties.gid, 1)
  assert.deepEqual(bboxOf(area), [13.0, 52.0, 13.4, 52.2]) // the A+B union, not A alone
  assert.equal(kiezAreaFor(PLR_B), area)                    // same group → same polygon
})

test('kiezAreaFor falls back to the Planungsraum itself without a group', () => {
  assert.equal(kiezAreaFor(PLR_TRI), PLR_TRI) // no gid
  assert.equal(kiezAreaFor(null), null)
})

// ── loadLevels + featureForLevel ─────────────────────────────────────────────
test('featureForLevel derives aggregate levels from the plr_id prefix', async () => {
  await loadLevels()
  assert.equal(levelFC().bez.features.length, 1)
  assert.equal(featureForLevel('bez', PLR_A).properties.id, '08')
  assert.equal(featureForLevel('pgr', PLR_A).properties.id, '0801')
  assert.equal(featureForLevel('bzr', PLR_A).properties.id, '080101')
  assert.equal(featureForLevel('plr', PLR_A), PLR_A)
  assert.equal(featureForLevel('kiez', PLR_A).properties.gid, 1) // merged area
  assert.equal(featureForLevel('bez', PLR_TRI), null) // '01' not in the fixture level map
  assert.equal(featureForLevel('bez', null), null)
})

test('loadLevels memoises its promise', async () => {
  const n = m.countFor('/data/bezirke.geojson')
  await loadLevels()
  assert.equal(m.countFor('/data/bezirke.geojson'), n)
})

// ── remaining simple loaders ─────────────────────────────────────────────────
test('loadOutline and loadKiezNames load once and memoise', async () => {
  const o1 = await loadOutline()
  const o2 = await loadOutline()
  assert.equal(o1, o2)
  assert.equal(m.countFor('/data/berlin-outline.geojson'), 1)
  const n1 = await loadKiezNames()
  const n2 = await loadKiezNames()
  assert.equal(n1, n2)
  assert.equal(m.countFor('/data/kiez-names.geojson'), 1)
})
