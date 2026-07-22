// Unit tests for src/city.js — the city-parameterization layer. Pure bbox
// lookup + the boot resolution (URL ?city= > localStorage > subdomain > Berlin)
// and the persist-and-reload switch, exercised with location/localStorage stubs.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CITIES, activeCity, cityIdForPoint, cityWasExplicit, resolveCity, switchCity } from '../src/city.js'

const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
const storage = (seed = {}) => {
  const m = new Map(Object.entries(seed))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }
}

test('cityIdForPoint maps a point to the city whose bbox contains it', () => {
  assert.equal(cityIdForPoint(13.404, 52.52), 'berlin') // Alexanderplatz
  assert.equal(cityIdForPoint(8.682, 50.111), 'frankfurt') // Römer
  assert.equal(cityIdForPoint(9.99, 53.55), null) // Hamburg → keine
})

test('CITIES: Berlin + Frankfurt with the expected shape', () => {
  assert.deepEqual(Object.keys(CITIES).sort(), ['berlin', 'frankfurt'])
  for (const c of Object.values(CITIES)) {
    assert.ok(c.term && c.article, `${c.id}: term + article`)
    assert.equal(c.center.length, 2)
    assert.equal(c.bbox.length, 4)
    assert.equal(c.fallback.length, 2)
    assert.ok(c.dataDir && c.outlineFile)
    assert.ok(Array.isArray(c.levels) && c.levels.length > 0)
  }
  assert.equal(CITIES.berlin.dataDir, '/data') // Berlin bleibt rückwärts-kompatibel
  assert.equal(CITIES.berlin.features.wall, true)
  assert.equal(CITIES.frankfurt.features.wall, false) // keine Mauer in Frankfurt
  assert.equal(CITIES.frankfurt.term, 'Stadtteil')
})

test('resolveCity: ?city= wins, then localStorage, else Berlin', () => {
  setGlobal('location', { href: 'https://x.io/?city=frankfurt', hostname: 'x.io' })
  setGlobal('localStorage', storage())
  assert.equal(resolveCity().id, 'frankfurt')
  assert.equal(activeCity().id, 'frankfurt')

  setGlobal('location', { href: 'https://x.io/', hostname: 'x.io' })
  setGlobal('localStorage', storage({ 'kf-city': 'frankfurt' }))
  assert.equal(resolveCity().id, 'frankfurt')

  setGlobal('location', { href: 'https://x.io/', hostname: 'x.io' })
  setGlobal('localStorage', storage())
  assert.equal(resolveCity().id, 'berlin') // Default

  setGlobal('location', { href: 'https://x.io/?city=paris', hostname: 'x.io' }) // unbekannt
  assert.equal(resolveCity().id, 'berlin') // fällt auf Default
})

test('cityWasExplicit: true nur bei bewusster Wahl (URL/localStorage/Subdomain), false beim Default', () => {
  // reiner Default → NICHT explizit (Standort darf die Stadt bestimmen)
  setGlobal('location', { href: 'https://x.io/', hostname: 'x.io' })
  setGlobal('localStorage', storage())
  resolveCity()
  assert.equal(cityWasExplicit(), false)

  // ?city= → explizit
  setGlobal('location', { href: 'https://x.io/?city=frankfurt', hostname: 'x.io' })
  resolveCity()
  assert.equal(cityWasExplicit(), true)

  // gespeicherte Wahl → explizit
  setGlobal('location', { href: 'https://x.io/', hostname: 'x.io' })
  setGlobal('localStorage', storage({ 'kf-city': 'berlin' }))
  resolveCity()
  assert.equal(cityWasExplicit(), true)

  // unbekannte ?city= fällt auf Default → NICHT explizit
  setGlobal('location', { href: 'https://x.io/?city=paris', hostname: 'x.io' })
  setGlobal('localStorage', storage())
  resolveCity()
  assert.equal(cityWasExplicit(), false)
})

test('CITIES tragen demonym für die „Kein <demonym> <term>"-Karte', () => {
  assert.equal(CITIES.berlin.demonym, 'Berliner')
  assert.equal(CITIES.frankfurt.demonym, 'Frankfurter')
})

test('resolveCity: a frankfurt subdomain picks Frankfurt', () => {
  setGlobal('location', { href: 'https://frankfurt.celox.io/', hostname: 'frankfurt.celox.io' })
  setGlobal('localStorage', storage())
  assert.equal(resolveCity().id, 'frankfurt')
})

test('switchCity persists + navigates; no-op for the already-active city', () => {
  let assigned = null
  setGlobal('location', { href: 'https://x.io/?city=frankfurt', hostname: 'x.io', assign(u) { assigned = u } })
  const st = storage()
  setGlobal('localStorage', st)
  resolveCity() // aktiv = frankfurt

  switchCity('frankfurt') // schon aktiv → nichts
  assert.equal(assigned, null)
  assert.equal(st.getItem('kf-city'), null)

  switchCity('berlin')
  assert.equal(st.getItem('kf-city'), 'berlin') // persistiert
  assert.match(assigned, /^\//) // navigiert (relativer Pfad, city-Param entfernt)
  assert.ok(!/city=/.test(assigned))

  switchCity('atlantis') // unbekannt → nichts
  assert.equal(st.getItem('kf-city'), 'berlin')
})
