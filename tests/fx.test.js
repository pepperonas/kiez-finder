// Pure helpers from src/fx.js — media-query driven, no anime DOM needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fxEnabled, fxDur, shouldSplitTitle, coarsePointer, isNarrow } from '../src/fx.js'

let rm = false, fp = true, coarse = false, narrow = false
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    matchMedia: (q) => ({
      matches: q.includes('reduced-motion') ? rm
        : q.includes('pointer: coarse') ? coarse
        : q.includes('max-width') ? narrow
        : q.includes('hover') || q.includes('pointer: fine') ? fp
        : false,
    }),
  },
})

test('fxEnabled mirrors prefers-reduced-motion', () => {
  rm = false
  assert.equal(fxEnabled(), true)
  rm = true
  assert.equal(fxEnabled(), false)
  rm = false
})

test('fxDur shortens on coarse pointers (phones)', () => {
  coarse = false
  assert.equal(fxDur(400), 400)
  coarse = true
  assert.equal(fxDur(400), 300)
  coarse = false
})

test('shouldSplitTitle only on fine desktop', () => {
  rm = false; fp = true; narrow = false; coarse = false
  assert.equal(shouldSplitTitle(), true)
  narrow = true
  assert.equal(shouldSplitTitle(), false)
  narrow = false; fp = false
  assert.equal(shouldSplitTitle(), false)
  fp = true; rm = true
  assert.equal(shouldSplitTitle(), false)
  rm = false
})

test('coarsePointer / isNarrow reflect matchMedia', () => {
  coarse = true; narrow = true
  assert.equal(coarsePointer(), true)
  assert.equal(isNarrow(), true)
  coarse = false; narrow = false
  assert.equal(coarsePointer(), false)
  assert.equal(isNarrow(), false)
})
