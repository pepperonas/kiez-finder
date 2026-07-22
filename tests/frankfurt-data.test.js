// Dataset tests for public/data/frankfurt/* — the shipped Frankfurt boundary,
// stats and street data (built by tools/build-frankfurt*.mjs + build-streets.js).
// Guards the app-compatible shapes + cross-file ID consistency, so a bad rebuild
// can't ship silently. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/frankfurt/${f}`, import.meta.url), 'utf8'))
const kieze = load('kieze.geojson')
const bezirke = load('bezirke.geojson')
const stats = load('stats.json')
const strassen = load('strassen.json')

test('kieze: 46 Stadtteile im App-Schema (plr_id/gid/kiez/bez, Polygon)', () => {
  assert.equal(kieze.features.length, 46)
  for (const f of kieze.features) {
    const p = f.properties
    assert.match(p.plr_id, /^\d{4}$/) // <OB2><lfd2>
    assert.equal(p.gid, p.plr_id) // jeder Stadtteil = eine eigene Fläche
    assert.ok(p.kiez && p.plr_name)
    assert.match(p.bez, /^\d{2} - .+/) // "01 - Innenstadt I"
    assert.equal(f.geometry.type, 'Polygon')
  }
  // eindeutige IDs + Namen
  assert.equal(new Set(kieze.features.map((f) => f.properties.plr_id)).size, 46)
  assert.equal(new Set(kieze.features.map((f) => f.properties.kiez)).size, 46)
})

test('bezirke: 16 Ortsbezirke, ids sind die plr_id-Präfixe', () => {
  assert.equal(bezirke.features.length, 16)
  const bezIds = new Set(bezirke.features.map((f) => f.properties.id))
  // JEDER Stadtteil-Präfix hat einen Ortsbezirk
  for (const f of kieze.features) assert.ok(bezIds.has(f.properties.plr_id.slice(0, 2)), `OB für ${f.properties.kiez}`)
})

test('stats: 46 Einträge [einwohner, m2, alterssumme], konsistent zu kieze', () => {
  const ids = Object.keys(stats.plr)
  assert.equal(ids.length, 46)
  for (const f of kieze.features) assert.ok(stats.plr[f.properties.plr_id], `stats für ${f.properties.kiez}`)
  let total = 0, na = 0
  for (const row of Object.values(stats.plr)) {
    assert.equal(row.length, 3)
    assert.ok(row[1] > 0) // Fläche immer da (geodätisch)
    assert.equal(row[2], null) // Altersstruktur noch keine Quelle
    if (row[0] == null) na++
    else { assert.ok(row[0] > 0); total += row[0] }
  }
  assert.equal(na, 1) // Flughafen ohne separate Bevölkerung
  assert.ok(total > 780000 && total < 810000, `Frankfurt-Summe ${total} plausibel`)
  assert.match(stats.stand, /2024/)
})

test('strassen: Index-Form + bekannte Frankfurter Straßen', () => {
  assert.equal(strassen.v, 1)
  assert.equal(strassen.bez.length, 16) // 16 Ortsbezirke
  assert.ok(strassen.streets.length > 3000)
  const names = new Set(strassen.streets.map((s) => s[0]))
  for (const n of ['Zeil', 'Kaiserstraße', 'Berger Straße']) assert.ok(names.has(n), n)
  for (const s of strassen.streets.slice(0, 100)) {
    assert.equal(s.length, 8) // [name, bezIdx, cx, cy, x1,y1,x2,y2]
    assert.ok(s[1] >= -1 && s[1] < 16)
  }
})
