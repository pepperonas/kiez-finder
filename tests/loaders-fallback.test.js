// Failure/fallback paths of the src/kiez.js loaders — runs in its OWN process
// (the test runner isolates per file), so this file gets a fresh module
// instance untouched by the happy-path state tests/loaders.test.js builds up.
//
// Order matters within this file: the hard-failure test runs FIRST (loadKieze
// memoises only a successful result, so a failed load may be retried), then the
// optional-datasets-missing scenario loads for real.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadKieze, kiezeFC, kiezAreasFC, findKiez, findOsmKiez, kiezAreaFor, featureForLevel } from '../src/kiez.js'
import { PLR_A, KIEZE, mockFetch } from './loaders-fixtures.mjs'

const m = mockFetch()
test.after(() => m.restore())

test('before any load: state-dependent functions answer safely', () => {
  assert.equal(findKiez(13.1, 52.1), null)
  assert.equal(findOsmKiez(13.1, 52.1), null)
  assert.equal(kiezeFC(), null)
  assert.equal(featureForLevel('bez', PLR_A), null) // levels not loaded yet
  assert.equal(featureForLevel('bez', null), null)
})

test('loadKieze surfaces a hard failure of the CORE dataset', async () => {
  m.failUrl('/data/kieze.geojson')
  await assert.rejects(loadKieze(), /500/) // must NOT masquerade as "outside Berlin"
  assert.equal(kiezeFC(), null)
})

test('loadKieze works without the optional areas/osm datasets (and retries after the failure above)', async () => {
  m.serve('/data/kieze.geojson', KIEZE) // core is back; areas/osm stay 404 → .catch(() => null)
  await loadKieze()
  assert.equal(findKiez(13.1, 52.1).properties.plr_name, 'Testfeld West') // core classification intact
  assert.equal(findOsmKiez(13.07, 52.07), null)   // no OSM data → null, no throw
  assert.equal(kiezAreaFor(PLR_A), PLR_A)          // no merge map → Planungsraum fallback
  assert.equal(kiezAreasFC(), null)
})
