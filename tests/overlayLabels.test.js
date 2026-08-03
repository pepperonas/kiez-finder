// Unit tests for overlay / selection label placement (visual centre + viewport).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  labelCandidates, viewBox, pickLabelPoint, shouldKeepLabel, LABEL_GRID,
  visualCenter, selectionAnchor, labelDepth, lonScale, gridFor,
  LABEL_GRID_MAX, LABEL_KEEP_RATIO,
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

// ── anchor = pole of inaccessibility of polygon ∩ viewport ────────────────

/** U-shape: the bbox mid AND the mid of any clipped slice fall in the notch. */
function uShape() {
  return {
    type: 'Feature',
    properties: { name: 'U' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0],
      ]],
    },
  }
}

test('lonScale corrects the lon/lat aspect (Berlin ≈ 0.61) and is clamped', () => {
  assert.ok(Math.abs(lonScale(52.5) - 0.608) < 0.01)
  assert.equal(lonScale(0), 1)
  assert.ok(lonScale(89) >= 0.15, 'no degenerate scale near the poles')
})

test('labelDepth measures distance to the visible border, lon aspect-corrected', () => {
  const view = viewBox(0, 10, 0, 10, 0.12) // lat mid 5 → kx ≈ 0.996
  // p[2] = precomputed distance to the polygon boundary
  assert.equal(labelDepth([5, 5, 0.4], view), 0.4, 'boundary is the tighter limit')
  assert.ok(Math.abs(labelDepth([5, 5, 99], view) - 4.98) < 0.05, 'else the screen edge')
  // at lat 60 (kx = 0.5) a 1° lon gap is only half a 1° lat gap
  const north = viewBox(0, 10, 55, 65, 0.12)
  assert.ok(Math.abs(labelDepth([1, 60, 99], north) - 0.5) < 0.01)
})

test('gridFor scales the candidate cloud with the area size, capped', () => {
  const tiny = gridFor([13.40, 52.48, 13.41, 52.49])       // ~1 km Kiez
  const huge = gridFor([13.20, 52.35, 13.76, 52.65])       // ~38 km Bezirk
  assert.equal(tiny, LABEL_GRID, 'small areas keep the base resolution')
  assert.equal(huge, LABEL_GRID_MAX, 'huge areas are capped, not unbounded')
  assert.ok(gridFor([13.30, 52.45, 13.45, 52.55]) > LABEL_GRID, 'mid-size areas get denser')
})

test('clipped area: anchor sits deep inside the visible part, NOT on its border', () => {
  const fc = { type: 'FeatureCollection', features: [uShape()] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  // clips the bottom bar away → the visible slice's bbox centre is in the notch
  const view = viewBox(0, 10, 2, 12, 0.12)
  const p = pickLabelPoint(c, view)
  assert.ok(p)
  // p[2] = distance to the polygon boundary. The legs are 3 wide, so a properly
  // centred anchor is ~1.5 away; the old "nearest point to the slice centre"
  // landed ON the notch edge (≈ 0).
  assert.ok(p[2] > 1.2, `anchor only ${p[2].toFixed(2)} from the boundary — it hugs the edge`)
  assert.ok(p[1] > 2 && p[1] < 12, 'inside the viewport')
})

test('anchor stays clear of the screen edge when the area runs off it', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'Wide', 0, 0, 100, 10)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  const view = viewBox(0, 20, 0, 10, 0.12) // only the west fifth is on screen
  const p = pickLabelPoint(c, view)
  assert.ok(p)
  assert.ok(p[0] > 3 && p[0] < 17, `lon ${p[0]} must sit mid-slice, not at a screen edge`)
  assert.ok(labelDepth(p, view) > 3, 'deep inside the visible slice')
})

test('fully visible area is unaffected — anchor is the plain visual centre', () => {
  const f = rect('08', 'Neukölln', 13.40, 52.45, 13.50, 52.52)
  const fc = { type: 'FeatureCollection', features: [f] }
  const [c] = labelCandidates(fc, (x) => x.properties.name)
  const p = pickLabelPoint(c, viewBox(13.2, 13.7, 52.35, 52.62, 0.12))
  const vc = visualCenter(f)
  assert.ok(Math.hypot(p[0] - vc[0], p[1] - vc[1]) < 0.006, `${p} vs visual centre ${vc}`)
})

test('hysteresis keeps a still-good anchor but releases a stale one', () => {
  const fc = { type: 'FeatureCollection', features: [rect('1', 'Box', 0, 0, 10, 10)] }
  const [c] = labelCandidates(fc, (f) => f.properties.name)
  const view = viewBox(0, 10, 0, 10, 0.12)
  const best = pickLabelPoint(c, view)
  // a kept anchor that is nearly as deep survives (no twitching while panning)
  const good = c.pts.find((p) => labelDepth(p, view) >= 0.9 * labelDepth(best, view)
    && (p[0] !== best[0] || p[1] !== best[1]))
  assert.ok(good, 'fixture sanity: a second near-optimal candidate exists')
  assert.deepEqual(pickLabelPoint(c, view, good), good)
  // one that panning pushed against the border is dropped for the better point
  const stale = c.pts.find((p) => labelDepth(p, view) < 0.5 * labelDepth(best, view)
    && shouldKeepLabel(p, view))
  assert.ok(stale, 'fixture sanity: a shallow but on-screen candidate exists')
  assert.deepEqual(pickLabelPoint(c, view, stale), best)
  assert.ok(LABEL_KEEP_RATIO > 0.5 && LABEL_KEEP_RATIO < 1)
})
