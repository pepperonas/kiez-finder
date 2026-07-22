// Unit tests for src/scenePresets.js — the per-theme config of the atmospheric
// 3D layer. Pure (no three.js / DOM): preset lookup + the viewport scaling that
// enforces the mobile constraints (fewer particles, DPR ≤ 2).
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCENE_PRESETS, presetFor, resolvedPreset } from '../src/scenePresets.js'

test('presetFor maps each theme, unknown falls back to dark', () => {
  assert.equal(presetFor('dark'), SCENE_PRESETS.dark)
  assert.equal(presetFor('light'), SCENE_PRESETS.light)
  assert.equal(presetFor('wall'), SCENE_PRESETS.wall)
  assert.equal(presetFor('nope'), SCENE_PRESETS.dark)
  assert.equal(presetFor(undefined), SCENE_PRESETS.dark)
})

test('every preset carries an accent token + the animatable params', () => {
  for (const [name, p] of Object.entries(SCENE_PRESETS)) {
    assert.ok(p.accentToken.startsWith('--'), `${name}: accentToken is a CSS var`)
    assert.ok(p.particleCount > 0)
    assert.ok(p.opacity > 0 && p.opacity < 0.2, `${name}: opacity is subtle`)
    assert.ok(p.speed > 0)
  }
  // themes are visually distinct: dark is denser/stronger than light
  assert.ok(SCENE_PRESETS.dark.particleCount > SCENE_PRESETS.light.particleCount)
  assert.ok(SCENE_PRESETS.dark.opacity > SCENE_PRESETS.light.opacity)
})

test('resolvedPreset: desktop keeps the count, only clamps DPR to ≤ 2', () => {
  const r = resolvedPreset(SCENE_PRESETS.dark, { mobile: false, dprCap: 3 })
  assert.equal(r.particleCount, SCENE_PRESETS.dark.particleCount)
  assert.equal(r.dprCap, 2)
  assert.equal(r.accentToken, '--accent') // spread keeps the rest
})

test('resolvedPreset: mobile cuts particles to ×0.4 (min 20) and caps DPR', () => {
  const r = resolvedPreset(SCENE_PRESETS.dark, { mobile: true, dprCap: 2 })
  assert.equal(r.particleCount, Math.round(150 * 0.4)) // 60
  assert.equal(r.dprCap, 2)
  // a tiny preset never drops below the floor of 20
  const tiny = resolvedPreset({ ...SCENE_PRESETS.wall, particleCount: 10 }, { mobile: true })
  assert.equal(tiny.particleCount, 20)
})

test('resolvedPreset defaults (no opts) = desktop, DPR 2', () => {
  const r = resolvedPreset(SCENE_PRESETS.light)
  assert.equal(r.particleCount, SCENE_PRESETS.light.particleCount)
  assert.equal(r.dprCap, 2)
})
