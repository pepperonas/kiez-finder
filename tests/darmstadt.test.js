// Darmstadt-spezifische Logik-Tests: Klassifikation bekannter Orte, Heat-Metriken
// ohne leere Alter/Miete, Suche, Schnitzeljagd-Nähe, City-BBoxes ohne Überlappung.
// Dataset-Shape → tests/darmstadt-data.test.js. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CITIES, cityIdForPoint, resolveCity, switchCity } from '../src/city.js'
import { availableMetrics, buildHeatFC } from '../src/heat.js'
import { decodePoi, poisNear, nearestPois, scopeProgress, markVisited, emptyProgress } from '../src/hunt.js'
import { buildSearchIndex, search } from '../src/search.js'
import { geodesicAreaM2 } from '../src/stats.js'

const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/darmstadt/${f}`, import.meta.url), 'utf8'))
const kieze = load('kieze.geojson')
const bezirke = load('bezirke.geojson')
const stats = load('stats.json')
const preise = load('preise.json')
const poisRaw = load('pois.json')
const strassen = load('strassen.json')
const outline = load('outline.geojson')

const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
const storage = (seed = {}) => {
  const m = new Map(Object.entries(seed))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

// ── Point-in-Polygon (even-odd, wie src/kiez.js) ─────────────────────────────
const ringsOf = (g) => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inGeom(pt, g) {
  let ins = false
  for (const poly of ringsOf(g)) for (const r of poly) if (inRing(pt, r)) ins = !ins
  return ins
}
function findViertel(lon, lat) {
  for (const f of kieze.features) if (inGeom([lon, lat], f.geometry)) return f
  return null
}

test('bekannte Orte klassifizieren in das richtige Viertel', () => {
  const cases = [
    [8.6515, 49.8726, 'Stadtzentrum'],              // Luisenplatz
    [8.66704, 49.87642, 'Mathildenhöhe'],            // Russische Kapelle
    [8.65528, 49.8736, 'Hochschulviertel'],          // Residenzschloss
    [8.62889, 49.8725, 'Waldkolonie'],               // Hauptbahnhof
  ]
  for (const [lon, lat, name] of cases) {
    const hit = findViertel(lon, lat)
    assert.ok(hit, `${name}: Treffer erwartet bei ${lon},${lat}`)
    assert.equal(hit.properties.kiez, name, `${lon},${lat} → ${hit.properties.kiez}, erwartet ${name}`)
  }
  assert.equal(findViertel(8.5, 49.5), null) // weit außerhalb
})

test('Stadtfläche ≈ 122 km² (amtlich ~122,23 km²)', () => {
  const m2 = outline.features.reduce((s, f) => s + geodesicAreaM2(f.geometry), 0)
  const km2 = m2 / 1e6
  assert.ok(km2 > 115 && km2 < 130, `outline ${km2.toFixed(1)} km²`)
})

test('city-BBoxes: Frankfurt und Darmstadt überlappen nicht; Fallback liegt innen', () => {
  const da = CITIES.darmstadt, ff = CITIES.frankfurt
  // Achsen-aligned: keine Überlappung wenn eine Seite komplett getrennt
  const overlap =
    da.bbox[0] <= ff.bbox[2] && ff.bbox[0] <= da.bbox[2] &&
    da.bbox[1] <= ff.bbox[3] && ff.bbox[1] <= da.bbox[3]
  assert.equal(overlap, false)
  assert.equal(cityIdForPoint(...da.fallback), 'darmstadt')
  assert.equal(cityIdForPoint(...ff.fallback), 'frankfurt')
  // Fallback-Punkt liegt im Stadtzentrum-Viertel
  assert.equal(findViertel(...da.fallback)?.properties.kiez, 'Stadtzentrum')
})

test('switchCity nach Darmstadt persistiert und navigiert', () => {
  let assigned = null
  setGlobal('location', { href: 'https://x.io/?city=berlin', hostname: 'x.io', assign(u) { assigned = u } })
  const st = storage()
  setGlobal('localStorage', st)
  resolveCity()
  switchCity('darmstadt')
  assert.equal(st.getItem('kf-city'), 'darmstadt')
  assert.match(assigned, /^\//)
  assert.ok(!/city=/.test(assigned))
})

test('availableMetrics: Darmstadt zeigt nur Dichte + Bodenrichtwert', () => {
  const keys = availableMetrics(stats, preise).map((m) => m.key)
  assert.deepEqual(keys, ['dichte', 'brw'])
})

test('buildHeatFC: Dichte+BRW gesetzt, Alter/Miete weggelassen', () => {
  const fc = buildHeatFC(kieze, stats, preise)
  assert.equal(fc.features.length, 37)
  let withBrw = 0
  for (const f of fc.features) {
    const p = f.properties
    assert.ok(typeof p.dichte === 'number' && p.dichte > 0)
    assert.equal('alter' in p, false)
    assert.equal('miete' in p, false)
    if ('brw' in p) { assert.ok(p.brw > 0); withBrw++ }
  }
  assert.ok(withBrw >= 30)
})

test('Suche findet Darmstädter Viertel und Straßen (city-aware Labels)', () => {
  const streets = strassen.streets.map(([name, bi, cx, cy, x1, y1, x2, y2]) => ({
    name, bez: strassen.bez[bi] || '', pt: [cx, cy], bbox: [x1, y1, x2, y2],
  }))
  buildSearchIndex({
    kieze,
    areas: kieze,
    bez: bezirke,
    streets,
    labels: { kiez: 'Viertel', bez: 'Stadtteil' },
    defaultSub: 'Darmstadt',
  })
  const viertel = search('stadtzentrum', 5)
  assert.ok(viertel.some((e) => e.label === 'Stadtzentrum' && e.type === 'kiez'))
  assert.equal(viertel[0].typeLabel, 'Viertel')
  const street = search('rheinstrasse', 8)
  assert.ok(street.some((e) => /Rheinstraße/i.test(e.label) && e.type === 'str'),
    `Rheinstraße in Treffern: ${street.map((e) => e.label).join(', ')}`)
  const math = search('mathilden', 5)
  assert.ok(math.some((e) => /Mathilden/i.test(e.label) && e.type === 'kiez'))
})

test('Schnitzeljagd: POIs dekodieren, Nähe am Luisenplatz, Scope-Fortschritt', () => {
  const list = poisRaw.pois.map(decodePoi)
  assert.equal(list.length, poisRaw.pois.length)
  assert.ok(list.some((p) => /Mathildenhöhe|Waldspirale|Landesmuseum/i.test(p.name)))

  // Luisenplatz: mindestens ein POI im 800-m-Radius (Innenstadt dicht)
  const near = poisNear(list, 49.8726, 8.6515, 800)
  assert.ok(near.length >= 1, `nahe POIs: ${near.length}`)
  assert.ok(near[0].dist <= 800)

  const nearest = nearestPois(list, 49.8726, 8.6515, 3)
  assert.equal(nearest.length, 3)
  assert.ok(nearest[0].dist <= nearest[1].dist)

  // Scope = Stadtzentrum-PLR
  const sz = kieze.features.find((f) => f.properties.kiez === 'Stadtzentrum')
  const plrIds = new Set([sz.properties.plr_id])
  const inSz = list.filter((p) => plrIds.has(p.plr))
  assert.ok(inSz.length >= 1)
  const { progress } = markVisited(emptyProgress(), inSz[0].qid)
  const scoped = scopeProgress(list, progress, plrIds)
  assert.equal(scoped.visited, 1)
  assert.equal(scoped.total, inSz.length)
})

test('jedes Viertel hängt am richtigen Stadtteil-Präfix', () => {
  const byId = Object.fromEntries(bezirke.features.map((f) => [f.properties.id, f.properties.bez_name]))
  for (const f of kieze.features) {
    const st = f.properties.plr_id.slice(0, 2)
    assert.equal(f.properties.st, st)
    assert.ok(byId[st], `Stadtteil ${st} für ${f.properties.kiez}`)
    assert.match(f.properties.bez, new RegExp(`^${st} - ${byId[st]}$`))
  }
})
