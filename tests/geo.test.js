// Unit tests for src/geo.js — geolocation error mapping + Nominatim reverse
// geocoding (address-line assembly, colloquial-Kiez extraction, sessionStorage
// caching, best-effort failure paths). The module touches its globals
// (navigator, sessionStorage, fetch) only at CALL time, so it tests in Node
// with plain global stubs — no extraction needed.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPosition, reverseGeocode } from '../src/geo.js'

// ── global stubs ─────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

function storageStub(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    _map: m,
  }
}
// GeolocationPositionError carries its own constants — mapGeoError reads them
// off the error object, so the stub mirrors that shape
const geoErr = (code) => ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })

test.after(() => { globalThis.fetch = realFetch })

// ── getPosition ──────────────────────────────────────────────────────────────
test('getPosition rejects as "unsupported" without a geolocation API', async () => {
  setGlobal('navigator', {})
  await assert.rejects(getPosition(), (e) => e.kind === 'unsupported')
})

test('getPosition resolves to a flat {lat, lon, accuracy}', async () => {
  setGlobal('navigator', { geolocation: { getCurrentPosition: (ok) =>
    ok({ coords: { latitude: 52.4886, longitude: 13.4283, accuracy: 12 } }) } })
  assert.deepEqual(await getPosition(), { lat: 52.4886, lon: 13.4283, accuracy: 12 })
})

test('getPosition maps every GeolocationPositionError code to a kind + German message', async () => {
  const kinds = { 1: 'denied', 2: 'unavailable', 3: 'timeout', 99: 'unknown' }
  for (const [code, kind] of Object.entries(kinds)) {
    setGlobal('navigator', { geolocation: { getCurrentPosition: (ok, fail) => fail(geoErr(+code)) } })
    await assert.rejects(getPosition(), (e) => {
      assert.equal(e.kind, kind)
      assert.ok(e.message && e.message.length > 10, 'carries a human message')
      return true
    })
  }
})

// ── reverseGeocode ───────────────────────────────────────────────────────────
const NOMINATIM = (address, display) => async () => ({
  ok: true, json: async () => ({ address, display_name: display }),
})

test('reverseGeocode assembles "Straße Hausnr, PLZ Ortsteil" and extracts the colloquial Kiez', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = NOMINATIM({
    road: 'Weserstraße', house_number: '47', postcode: '12045', suburb: 'Neukölln', quarter: 'Reuterkiez',
  })
  const out = await reverseGeocode(52.4886, 13.4283)
  assert.equal(out.line, 'Weserstraße 47, 12045 Neukölln')
  assert.equal(out.kiez, 'Reuterkiez')
})

test('reverseGeocode: neighbourhood is the Kiez fallback; partial addresses stay clean', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = NOMINATIM({ road: 'Sonnenallee', neighbourhood: 'Rollbergkiez', city_district: 'Neukölln' })
  const out = await reverseGeocode(52.48, 13.43)
  assert.equal(out.line, 'Sonnenallee, Neukölln') // no house number, no postcode — no dangling separators
  assert.equal(out.kiez, 'Rollbergkiez')          // quarter absent → neighbourhood
})

test('reverseGeocode falls back to display_name when no address parts assemble', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = NOMINATIM({}, 'Berlin, Deutschland')
  const out = await reverseGeocode(52.52, 13.4)
  assert.equal(out.line, 'Berlin, Deutschland')
  assert.equal(out.kiez, null)
})

test('reverseGeocode caches per rounded coordinate (no second fetch)', async () => {
  const store = storageStub()
  setGlobal('sessionStorage', store)
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ address: { road: 'Testweg' } }) } }
  await reverseGeocode(52.48861, 13.42831)
  // 4-decimal cache key → the ~1m-different re-check hits the cache
  const out = await reverseGeocode(52.48858, 13.42829)
  assert.equal(calls, 1)
  assert.equal(out.line, 'Testweg')
  assert.equal(store._map.size, 1)
})

test('reverseGeocode is best-effort: HTTP error and thrown fetch both yield null', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) })
  assert.equal(await reverseGeocode(52.5, 13.4), null)
  globalThis.fetch = async () => { throw new Error('network down') }
  assert.equal(await reverseGeocode(52.51, 13.41), null)
})

test('reverseGeocode: address with no road drops the street part cleanly', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = NOMINATIM({ postcode: '12045', suburb: 'Neukölln' })
  const out = await reverseGeocode(52.48, 13.43)
  assert.equal(out.line, '12045 Neukölln') // no leading ", " from the empty street
  assert.equal(out.kiez, null)
})

test('reverseGeocode: borough is the last Ortsteil fallback after suburb/city_district', async () => {
  setGlobal('sessionStorage', storageStub())
  globalThis.fetch = NOMINATIM({ road: 'Karl-Marx-Straße', borough: 'Neukölln' })
  const out = await reverseGeocode(52.47, 13.44)
  assert.equal(out.line, 'Karl-Marx-Straße, Neukölln')
})

test('reverseGeocode: distinct rounded coordinates each trigger their own fetch', async () => {
  const store = storageStub()
  setGlobal('sessionStorage', store)
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ address: { road: 'Weg' } }) } }
  await reverseGeocode(52.4800, 13.4300)
  await reverseGeocode(52.4900, 13.4400) // > 1e-4 apart → different cache key
  assert.equal(calls, 2)
  assert.equal(store._map.size, 2)
})

test('reverseGeocode: a cached hit returns the parsed object without touching fetch', async () => {
  const cached = { line: 'Aus Cache 1', kiez: 'Reuterkiez', raw: {} }
  setGlobal('sessionStorage', storageStub({ 'kf-rev-52.5200,13.4000': JSON.stringify(cached) }))
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ address: {} }) } }
  const out = await reverseGeocode(52.52, 13.40)
  assert.deepEqual(out, cached)
  assert.equal(calls, 0)
})

test('reverseGeocode survives a throwing sessionStorage (private mode)', async () => {
  setGlobal('sessionStorage', {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('SecurityError') },
  })
  globalThis.fetch = NOMINATIM({ road: 'Kottbusser Damm' })
  const out = await reverseGeocode(52.49, 13.42)
  assert.equal(out.line, 'Kottbusser Damm') // still resolves, just uncached
})
