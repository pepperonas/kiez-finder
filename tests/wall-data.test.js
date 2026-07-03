// Sanity tests for the Berlin Wall datasets (public/data/mauer.geojson +
// west-berlin.geojson) and the Ost/West side classification used by the
// wall-mode chip (pointInGeometry against the stitched West-Berlin ring).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pointInGeometry } from '../src/kiez.js'

const wall = JSON.parse(readFileSync(new URL('../public/data/mauer.geojson', import.meta.url)))
const westFC = JSON.parse(readFileSync(new URL('../public/data/west-berlin.geojson', import.meta.url)))
const west = westFC.features[0]

test('mauer.geojson carries all three feature types', () => {
  const types = new Set(wall.features.map((f) => f.properties.typ))
  assert.deepEqual([...types].sort(), ['hinterland', 'mauer', 'streifen'])
  // lines for the walls, polygons for the Grenzstreifen
  for (const f of wall.features) {
    const expect = f.properties.typ === 'streifen' ? 'Polygon' : 'LineString'
    assert.equal(f.geometry.type, expect)
  }
})

test('west-berlin.geojson is one polygon with a plausible area (~480 km²)', () => {
  assert.equal(westFC.features.length, 1)
  assert.equal(west.geometry.type, 'Polygon')
  // shoelace area at Berlin latitude
  const kx = 111.32 * Math.cos((52.5 * Math.PI) / 180), ky = 111.32
  let s = 0
  const ring = west.geometry.coordinates[0]
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]
    s += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky)
  }
  const km2 = Math.abs(s) / 2
  assert.ok(km2 > 460 && km2 < 500, `expected ~480 km², got ${km2.toFixed(1)}`)
})

test('known places classify to the correct side of the wall', () => {
  const westSide = (lon, lat) => pointInGeometry(west.geometry, lon, lat)
  assert.equal(westSide(13.332, 52.504), true, 'Kurfürstendamm → West')
  assert.equal(westSide(13.1995, 52.5355), true, 'Spandau → West')
  assert.equal(westSide(13.3407, 52.5316), true, 'Wedding (Leopoldplatz) → West')
  assert.equal(westSide(13.4132, 52.5219), false, 'Alexanderplatz → Ost')
  assert.equal(westSide(13.5744, 52.4455), false, 'Köpenick → Ost')
  assert.equal(westSide(13.4531, 52.5323), false, 'Friedrichshain (Frankfurter Tor) → Ost')
  assert.equal(westSide(11.575, 48.137), false, 'München → weder noch')
})
