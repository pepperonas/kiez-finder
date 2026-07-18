// ─────────────────────────────────────────────────────────────────────────
// prefs.js — dependency-free, DOM-free persisted preferences.
//
// Extracted so the persistence SEMANTICS unit-test without importing the
// DOM/MapLibre-heavy main.js (see tests/prefs.test.js). Storage is injected,
// so a test passes a plain stub — and a throwing/absent storage (Safari
// private mode, disabled storage, SSR) simply falls back to the default.
// ─────────────────────────────────────────────────────────────────────────

// Read a boolean pref. Explicit '1'/'0' win; anything else — unset, null,
// garbage, or a storage that throws — yields `dflt`.
export function readBoolPref(storage, key, dflt) {
  try {
    const v = storage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
  } catch (e) {}
  return dflt
}

// Persist a boolean pref as '1'/'0'; returns the written string. A
// throwing/absent storage is swallowed — persistence is best-effort.
export function writeBoolPref(storage, key, on) {
  const v = on ? '1' : '0'
  try { storage.setItem(key, v) } catch (e) {}
  return v
}
