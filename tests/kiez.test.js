// Unit tests for the pure logic in src/kiez.js — the geolocation classification
// core (point-in-polygon) plus the hierarchy/format helpers.
// Run with: npm test   (Node's built-in test runner, no deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bezirkName, kmFromBerlin, bboxOf, levelName, pointInGeometry, BERLIN_CENTER,
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
})
