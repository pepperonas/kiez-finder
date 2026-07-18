// Unit tests for src/prefs.js — the DOM-free persisted-preference helpers that
// back the Auto-Zoom toggle (kf-autozoom) and any future boolean pref.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBoolPref, writeBoolPref } from '../src/prefs.js'

// a minimal in-memory Storage stub (matches the getItem/setItem contract)
function stubStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    _map: m,
  }
}

// ── readBoolPref ─────────────────────────────────────────────────────────────
test('readBoolPref: explicit "1"/"0" win over the default', () => {
  assert.equal(readBoolPref(stubStorage({ k: '1' }), 'k', false), true)
  assert.equal(readBoolPref(stubStorage({ k: '0' }), 'k', true), false)
})

test('readBoolPref: unset key falls back to the default (either way)', () => {
  assert.equal(readBoolPref(stubStorage(), 'k', true), true)
  assert.equal(readBoolPref(stubStorage(), 'k', false), false)
})

test('readBoolPref: garbage / legacy values fall back to the default', () => {
  for (const v of ['', 'yes', 'true', '2', 'null', ' 1']) {
    assert.equal(readBoolPref(stubStorage({ k: v }), 'k', true), true, `"${v}" → default true`)
    assert.equal(readBoolPref(stubStorage({ k: v }), 'k', false), false, `"${v}" → default false`)
  }
})

test('readBoolPref: a throwing or absent storage yields the default (private mode / SSR)', () => {
  const throwing = { getItem() { throw new Error('SecurityError') } }
  assert.equal(readBoolPref(throwing, 'k', true), true)
  assert.equal(readBoolPref(null, 'k', true), true)       // storage.getItem → TypeError, caught
  assert.equal(readBoolPref(undefined, 'k', false), false)
})

// mirrors the live default: auto-zoom is ON unless explicitly turned off ('0')
test('readBoolPref: models the kf-autozoom default (on unless "0")', () => {
  const on = (seed) => readBoolPref(stubStorage(seed), 'kf-autozoom', true)
  assert.equal(on({}), true)                       // first visit → on
  assert.equal(on({ 'kf-autozoom': '1' }), true)   // persisted on
  assert.equal(on({ 'kf-autozoom': '0' }), false)  // persisted off
})

// ── writeBoolPref ────────────────────────────────────────────────────────────
test('writeBoolPref: persists "1"/"0" and returns the written string', () => {
  const s = stubStorage()
  assert.equal(writeBoolPref(s, 'k', true), '1')
  assert.equal(s.getItem('k'), '1')
  assert.equal(writeBoolPref(s, 'k', false), '0')
  assert.equal(s.getItem('k'), '0')
})

test('writeBoolPref: round-trips through readBoolPref', () => {
  const s = stubStorage()
  for (const on of [true, false, true]) {
    writeBoolPref(s, 'kf-autozoom', on)
    assert.equal(readBoolPref(s, 'kf-autozoom', !on), on)
  }
})

test('writeBoolPref: a throwing storage is swallowed but still returns the value', () => {
  const throwing = { setItem() { throw new Error('QuotaExceeded') } }
  assert.equal(writeBoolPref(throwing, 'k', true), '1') // best-effort: no throw
  assert.equal(writeBoolPref(null, 'k', false), '0')
})
