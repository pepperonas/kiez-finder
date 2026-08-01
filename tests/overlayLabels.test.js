// Unit tests for overlay / selection label placement (visual centre + viewport).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  labelCandidates, viewBox, pickLabelPoint, shouldKeepLabel, LABEL_GRID,
  visualCenter, selectionAnchor,
} from '../src/overlayLabels.js'

/** Axis-aligned rectangle polygon as a GeoJSON Feature. */
function rect(id, name, minLon, minLat, maxLon, maxLat) {
  return {
    type: 'Feature',
    properties: { id, name },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat],
      ]],
    },
  }
}

/** L-shape: bbox centre sits OUTSIDE the polygon (classic label bug). */
function lShape() {
  // two rectangles sharing a corner — exterior ring of an L
  return {
    type: 'Feature',
    properties: { name: 'L' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6], [0, 0],
      ]],
    },
  }
}

test('LABEL_GRID is denser than the old 4×4', () => {
  assert.ok(LABEL_GRID >= 6)
})

test('visualCenter sits near the middle of a rectangle', () => {
  const f = rect('1', 'Box', 0, 0, 10, 10)
  const p = visualCenter(f)
  assert.ok(p)
  assert.ok(Math.abs(p[0] - 5) < 1.2, `x=${p[0]}`)
  assert.ok(Math.abs(p[1] - 5) < 1.2, `y=${p[1]}`)
})

test('visualCenter stays INSIDE an L-shape (bbox mid would be outside)', () => {
  const f = lShape()
  const p = visualCenter(f)
  assert.ok(p)
  // bbox mid ≈ (3,3) is OUTSIDE this L; visual centre must be inside the stem
  const bbMidOutside = !(p[0] > 2 && p[1] > 2) // if both >2 might still be in corner void
  // Point-in-polygon check via a second visualCenter guarantee: must be in the thick arm
  assert.ok(
    (p[0] <= 2.5 && p[1] >= 0 && p[1] <= 6) || (p[1] <= 2.5 && p[0] >= 0 && p[0] <= 6),
    `visual centre ${p} must lie in the L, not the empty corner`,
  )
  assert.ok(bbMidOutside || p[0] < 2.8 || p[1] < 2.8, 'must not prefer empty bbox mid (3,3)')
})

test('labelCandidates uses visual centre as c', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'Bessungen', 0, 0, 10, 10)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  assert.equal(c.name, 'Bessungen')
  assert.ok(Math.abs(c.c[0] - 5) < 1.2)
  assert.ok(c.pts.length > 4)
})

test('pickLabelPoint uses visible-slice centre when area is clipped', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'Bessungen', 0, 0, 20, 10)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  const view = viewBox(10, 20, 0, 10, 0.12)
  const p = pickLabelPoint(c, view)
  assert.ok(p)
  assert.ok(p[0] > 12, `lon ${p[0]} inside visible slice`)
  assert.ok(Math.abs(p[0] - 15) < 3)
})

test('pickLabelPoint keeps mid-area when fully visible (not pulled to map centre)', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'Neukölln', 0, 0, 10, 10)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  const view = viewBox(-5, 15, -5, 45, 0.08)
  const p = pickLabelPoint(c, view)
  assert.ok(p)
  assert.ok(Math.abs(p[0] - 5) < 2.5, `lon ${p[0]}`)
  assert.ok(Math.abs(p[1] - 5) < 2.5, `lat ${p[1]} must not drift north`)
})

test('selectionAnchor matches visual centre when fully on screen', () => {
  const f = rect('08', 'Neukölln', 13.40, 52.45, 13.50, 52.52)
  const view = viewBox(13.35, 13.55, 52.40, 52.55, 0.1)
  const a = selectionAnchor(f, view)
  const vc = visualCenter(f)
  assert.ok(a && vc)
  assert.ok(Math.hypot(a[0] - vc[0], a[1] - vc[1]) < 0.01,
    `selection ${a} should ≈ visual centre ${vc}`)
})

test('pickLabelPoint returns null when polygon is fully off-screen', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'X', 0, 0, 5, 5)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  assert.equal(pickLabelPoint(c, viewBox(50, 60, 50, 60, 0.12)), null)
})

test('shouldKeepLabel drops points that hug the viewport edge', () => {
  const view = viewBox(0, 10, 0, 10, 0.12)
  assert.equal(shouldKeepLabel([5, 5], view), true)
  assert.equal(shouldKeepLabel([0.1, 5], view), false)
  assert.equal(shouldKeepLabel(null, view), false)
})
