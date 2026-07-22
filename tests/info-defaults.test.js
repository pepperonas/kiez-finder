// Unit tests for the default/empty-field branches of the enrichment accessors
// (hunt.js `poiInfo`, stats.js `kiezImg`). These live in a SEPARATE file because
// both loaders memoise their fetch modulewide — a fresh process gives us a clean
// _info/_kimg so we can drive the "loaded but sparse entry" and "not loaded yet"
// paths that tests/hunt.test.js and tests/stats.test.js can no longer reach once
// they've populated the cache. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPoiInfo, poiInfo } from '../src/hunt.js'
import { loadKiezImg, kiezImg } from '../src/stats.js'

test('poiInfo is null before anything is loaded', () => {
  assert.equal(poiInfo(82425), null) // _info still null
})

test('poiInfo: sparse entries default img→false, credit→null, extract→null', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ info: {
    500: { x: 'Nur Text mit Bild', img: 1 },   // hat Bild, aber KEIN credit
    501: { img: 0 },                            // weder extract noch credit
    502: { x: 'Text ohne Bild', img: 0, credit: 'Foo' },
  } }) })
  try {
    await loadPoiInfo()
    assert.deepEqual(poiInfo(500), { extract: 'Nur Text mit Bild', img: true, credit: null })
    assert.deepEqual(poiInfo(501), { extract: null, img: false, credit: null })
    assert.deepEqual(poiInfo(502), { extract: 'Text ohne Bild', img: false, credit: 'Foo' })
    assert.equal(poiInfo(999), null) // unbekannt
  } finally { globalThis.fetch = realFetch }
})

test('kiezImg is null before load and defaults a missing credit to "Wikimedia Commons"', async () => {
  assert.equal(kiezImg('k1'), null) // _kimg noch nicht geladen
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ info: {
    k1: { img: 1 },                    // Bild ohne credit → Default-Attribution
    k2: { img: 1, credit: 'Autor X' }, // eigener credit bleibt
    k3: { img: 0 },                    // kein Bild
  } }) })
  try {
    await loadKiezImg()
    assert.deepEqual(kiezImg('k1'), { img: true, credit: 'Wikimedia Commons' })
    assert.deepEqual(kiezImg('k2'), { img: true, credit: 'Autor X' })
    assert.equal(kiezImg('k3'), null)
  } finally { globalThis.fetch = realFetch }
})
