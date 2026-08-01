import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { poiDotTol, POI_DOT_TOL_MAX } from '../src/poiHit.js'

describe('poiDotTol', () => {
  it('is zero at city-wide zooms (many km² on screen)', () => {
    assert.equal(poiDotTol(11), 0)
    assert.equal(poiDotTol(11.5), 0)
    assert.equal(poiDotTol(12), 0)
  })

  it('ramps between z12 and z14', () => {
    assert.equal(poiDotTol(12.5), 3) // 0.25 × 10 → 3
    assert.equal(poiDotTol(13), 5)
    assert.equal(poiDotTol(13.5), 8) // 0.75 × 10 → 8
  })

  it('is full pad at neighbourhood zoom and beyond', () => {
    assert.equal(poiDotTol(14), POI_DOT_TOL_MAX)
    assert.equal(poiDotTol(15), POI_DOT_TOL_MAX)
    assert.equal(poiDotTol(17), POI_DOT_TOL_MAX)
  })

  it('treats non-numeric / NaN as zero-pad (safe fallback)', () => {
    assert.equal(poiDotTol(NaN), 0)
    assert.equal(poiDotTol(undefined), 0)
  })
})
