// Unit tests for the pure logic in src/kiez.js — the geolocation classification
// core (point-in-polygon) plus the hierarchy/format helpers.
// Run with: npm test   (Node's built-in test runner, no deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bezirkName, kmFromBerlin, bboxOf, levelName, pointInGeometry, BERLIN_CENTER,
  LEVELS, kiezAreaFor, featureForLevel, findKiez, findOsmKiez, kiezeFC, levelFC,
} from '../src/kiez.js'

const square = (minX, minY, maxX, maxY) => ({
  type: 'Polygon',
  coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]],
})

test('bezirkName strips the "NN - " prefix', () => {
  assert.equal(bezirkName('01 - Mitte'), 'Mitte')
  assert.equal(bezirkName('12 - Reinickendorf'), 'Reinickendorf')
  assert.equal(bezirkName('08 - Neukölln'), 'Neukölln')
  assert.equal(bezirkName('Mitte'), 'Mitte') // already clean
  assert.equal(bezirkName(''), '')
  assert.equal(bezirkName(null), '')
})

test('kmFromBerlin is ~0 at the centre and grows with distance', () => {
  const [clon, clat] = BERLIN_CENTER
  assert.ok(kmFromBerlin(clon, clat) < 0.001)
  const near = kmFromBerlin(clon + 0.05, clat)
  const far = kmFromBerlin(clon + 0.2, clat)
  assert.ok(near > 0 && far > near)
  // ~0.2° lon at 52.5°N ≈ 13.5 km — sanity bound
  assert.ok(far > 10 && far < 18, `expected ~13.5 km, got ${far}`)
})

test('bboxOf computes a feature bounding box', () => {
  const f = { type: 'Feature', properties: {}, geometry: square(13.0, 52.0, 13.5, 52.4) }
  assert.deepEqual(bboxOf(f), [13.0, 52.0, 13.5, 52.4])
  assert.equal(bboxOf(null), null)
})

test('bboxOf spans every part of a MultiPolygon', () => {
  const f = {
    type: 'Feature', properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [square(0, 0, 1, 1).coordinates, square(2, 2, 4, 5).coordinates] },
  }
  assert.deepEqual(bboxOf(f), [0, 0, 4, 5])
})

test('pointInGeometry: inside vs outside a simple polygon', () => {
  const g = square(13.0, 52.0, 13.4, 52.4)
  assert.equal(pointInGeometry(g, 13.2, 52.2), true)
  assert.equal(pointInGeometry(g, 13.5, 52.2), false) // east of it
  assert.equal(pointInGeometry(g, 12.9, 52.2), false) // west of it
  assert.equal(pointInGeometry(g, 13.2, 52.9), false) // north of it
})

test('pointInGeometry: a hole counts as outside', () => {
  const g = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // outer
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],     // hole
    ],
  }
  assert.equal(pointInGeometry(g, 1, 1), true)  // in outer, clear of hole
  assert.equal(pointInGeometry(g, 5, 5), false) // inside the hole → outside
})

test('pointInGeometry: MultiPolygon membership', () => {
  const g = { type: 'MultiPolygon', coordinates: [square(0, 0, 1, 1).coordinates, square(5, 5, 6, 6).coordinates] }
  assert.equal(pointInGeometry(g, 0.5, 0.5), true)
  assert.equal(pointInGeometry(g, 5.5, 5.5), true)
  assert.equal(pointInGeometry(g, 3, 3), false) // gap between the two parts
})

test('pointInGeometry: null/unsupported geometry is not inside', () => {
  assert.equal(pointInGeometry(null, 1, 1), false)
  assert.equal(pointInGeometry({ type: 'Point', coordinates: [1, 1] }, 1, 1), false)
})

test('bezirkName trims surrounding whitespace and single-digit prefixes', () => {
  assert.equal(bezirkName('  Mitte  '), 'Mitte')
  assert.equal(bezirkName('1 - Mitte'), 'Mitte')      // single digit
  assert.equal(bezirkName('08-Neukölln'), 'Neukölln') // no spaces around the dash
  assert.equal(bezirkName(undefined), '')
})

test('kmFromBerlin separates the latitude and longitude contributions', () => {
  const [clon, clat] = BERLIN_CENTER
  // 0.1° latitude ≈ 11.13 km (no cos scaling on lat)
  const dLat = kmFromBerlin(clon, clat + 0.1)
  assert.ok(Math.abs(dLat - 11.132) < 0.05, `~11.13 km, got ${dLat}`)
  // 0.1° longitude at 52.5°N ≈ 11.13 × cos(52.5°) ≈ 6.78 km — shorter than the lat step
  const dLon = kmFromBerlin(clon + 0.1, clat)
  assert.ok(dLon < dLat && dLon > 6.5 && dLon < 7.1, `~6.8 km, got ${dLon}`)
})

test('bboxOf includes holes but they never extend the outer bounds', () => {
  const withHole = {
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // outer
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],     // hole (interior → no effect on bbox)
    ] },
  }
  assert.deepEqual(bboxOf(withHole), [0, 0, 10, 10])
})

test('pointInGeometry: a concave (L-shaped) polygon excludes its notch', () => {
  // L-shape occupying the lower and left, with the top-right corner cut out
  const L = { type: 'Polygon', coordinates: [[
    [0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0],
  ]] }
  assert.equal(pointInGeometry(L, 1, 1), true)   // inside the solid corner
  assert.equal(pointInGeometry(L, 2, 8), true)   // inside the left arm
  assert.equal(pointInGeometry(L, 8, 8), false)  // in the cut-out notch → outside
})

test('pointInGeometry: MultiPolygon where one part carries a hole', () => {
  const g = { type: 'MultiPolygon', coordinates: [
    [ // part A with a hole
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
    [ // part B, solid
      [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]],
    ],
  ] }
  assert.equal(pointInGeometry(g, 1, 1), true)    // A, clear of the hole
  assert.equal(pointInGeometry(g, 5, 5), false)   // inside A's hole → outside
  assert.equal(pointInGeometry(g, 21, 21), true)  // inside B
  assert.equal(pointInGeometry(g, 15, 15), false) // between the parts
})

// ── fresh-state guards (nothing loaded — kiez.test.js never imports loaders) ──
test('accessors and finders are null/empty before any load', () => {
  assert.equal(kiezeFC(), null)
  assert.equal(levelFC(), null)
  assert.equal(findKiez(13.4, 52.5), null)   // no data → no classification
  assert.equal(findOsmKiez(13.4, 52.5), null)
})

test('kiezAreaFor without loaded areas falls back to the feature itself (even with a gid)', () => {
  const plr = { properties: { gid: 7, plr_id: '08010101' } }
  assert.equal(kiezAreaFor(plr), plr) // no _kiezAreaByGid yet → identity, not null
  assert.equal(kiezAreaFor(null), null)
})

test('featureForLevel: plr/kiez resolve locally, aggregate levels need loaded maps', () => {
  const plr = { properties: { gid: 7, plr_id: '08010101' } }
  assert.equal(featureForLevel('plr', plr), plr)
  assert.equal(featureForLevel('kiez', plr), plr) // → kiezAreaFor fallback = itself
  assert.equal(featureForLevel('bez', plr), null) // no _levelMaps loaded → null
  assert.equal(featureForLevel('bzr', null), null)
})

test('LEVELS lists the four LOR tiers with key + label', () => {
  assert.deepEqual(LEVELS.map((l) => l.key), ['plr', 'bez', 'bzr', 'pgr'])
  for (const l of LEVELS) assert.ok(l.label && typeof l.label === 'string')
  assert.deepEqual(BERLIN_CENTER, [13.404, 52.52])
})

test('levelName reads the right hierarchy field for a Planungsraum', () => {
  const plr = { properties: {
    kiez: 'Flughafenkiez', plr_name: 'Flughafenstraße',
    bzr_name: 'Neuköllner Mitte/Zentrum', pgr_name: 'Neukölln', bez: '08 - Neukölln',
  } }
  assert.equal(levelName('kiez', plr), 'Flughafenkiez')
  assert.equal(levelName('plr', plr), 'Flughafenstraße')
  assert.equal(levelName('bzr', plr), 'Neuköllner Mitte/Zentrum')
  assert.equal(levelName('pgr', plr), 'Neukölln')
  assert.equal(levelName('bez', plr), 'Neukölln') // bezirkName applied
  assert.equal(levelName('kiez', { properties: { plr_name: 'X' } }), 'X') // falls back to plr_name
  assert.equal(levelName('bez', null), '—')
  assert.equal(levelName('nope', plr), '—') // unknown level key → em-dash fallback
})
