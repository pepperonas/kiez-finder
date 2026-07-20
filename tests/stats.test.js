// Unit tests for src/stats.js — Bereichs-Statistiken: Selektoren (gid/Präfix),
// PLR-Aggregation (inkl. SAFE-anonymisierter NA-Werte), Ränge je Ebene,
// geodätische Fläche für OSM-Kieze, Wikipedia-Lookups, de-DE-Formatierung.
// Alles pure Funktionen mit injizierten Fixtures — kein Fetch, kein DOM.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadStats, loadKiezInfo, statsData, infoData,
  selectorFor, selectorForFeature, aggregate, ranksFor, clearRankCache,
  geodesicAreaM2, infoFor, infoForBezirk, fmtInt, fmtKm2, fmtDichte, fmtAlter, fmtAnteil, fmtEuroM2,
} from '../src/stats.js'

// ── Fixture: 5 PLRs — 4 Kiez-Gruppen, 2 Bezirke, ein NA (SAFE-anonymisiert) ──
const plr = (plr_id, gid) => ({ type: 'Feature', properties: { plr_id, gid }, geometry: null })
const FC = { type: 'FeatureCollection', features: [
  plr('08010101', 'k1'), // Kiezgruppe k1 …
  plr('08010102', 'k1'), // … zwei PLRs, gleiche BZR 080101
  plr('08020201', 'k2'), // gleicher Bezirk 08, andere BZR/PGR
  plr('01011101', 'k3'), // Bezirk 01 — Einwohner anonymisiert (NA)
  plr('01011102', 'k4'), // Bezirk 01
] }
// [pop, m2, alterssumme (Σ Bandmitte×Besetzung), u18, ab65]
const DATA = { stand: '31.12.2025', plr: {
  '08010101': [1000, 500000, 40000, 150, 100],  // Ø 40,0
  '08010102': [2000, 500000, 90000, 300, 400],  // Ø 45,0
  '08020201': [4000, 1000000, 160000, 800, 600],
  '01011101': [null, 200000, null, null, null], // "NA"
  '01011102': [500, 300000, 25000, 50, 125],
} }

// ── Loader (fetch-Stub): memoisiert, Fehlschlag → null statt Throw ───────────
test('loadStats/loadKiezInfo laden einmal, memoisieren und schlucken Fehler', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    calls++
    if (url.includes('stats')) return { ok: true, json: async () => ({ stand: 'T', plr: {} }) }
    return { ok: false, status: 404 } // kiez-info fehlt → Feature entfällt still
  }
  try {
    const s1 = await loadStats()
    const s2 = await loadStats()
    assert.equal(s1, s2)
    assert.equal(s1.stand, 'T')
    assert.equal(statsData(), s1)
    assert.equal(await loadKiezInfo(), null) // !ok → null, kein Throw
    assert.equal(infoData(), null)
    assert.equal(calls, 2) // je Datei genau ein Fetch (Promise memoisiert)
  } finally { globalThis.fetch = realFetch }
})

// ── Selektoren ───────────────────────────────────────────────────────────────
test('selectorFor: Kiez = gid-Gruppe, Ebenen = plr_id-Präfix, plr = er selbst', () => {
  const f = FC.features[0]
  assert.deepEqual(selectorFor('kiez', f), { kind: 'gid', v: 'k1' })
  assert.deepEqual(selectorFor('bzr', f), { kind: 'prefix', v: '080101' })
  assert.deepEqual(selectorFor('pgr', f), { kind: 'prefix', v: '0801' })
  assert.deepEqual(selectorFor('bez', f), { kind: 'prefix', v: '08' })
  assert.deepEqual(selectorFor('plr', f), { kind: 'plr', v: '08010101' })
  assert.equal(selectorFor('kiez', null), null)
  assert.equal(selectorFor('nope', f), null) // unbekannte Ebene
  // PLR ohne gid → fällt auf sich selbst zurück
  assert.deepEqual(selectorFor('kiez', plr('99999999', undefined)), { kind: 'plr', v: '99999999' })
})

test('selectorForFeature: Such-Treffer (Aggregat-Features mit id, Kiez-Fläche mit gid)', () => {
  assert.deepEqual(selectorForFeature('kiez', { properties: { gid: 'k1', kiez: 'X' } }), { kind: 'gid', v: 'k1' })
  assert.deepEqual(selectorForFeature('bez', { properties: { id: '08' } }), { kind: 'prefix', v: '08' })
  assert.deepEqual(selectorForFeature('bzr', { properties: { id: '080101' } }), { kind: 'prefix', v: '080101' })
  assert.deepEqual(selectorForFeature('plr', { properties: { plr_id: '08010101' } }), { kind: 'plr', v: '08010101' })
  assert.equal(selectorForFeature('str', { properties: {} }), null) // Straßen haben keine Statistik-Einheit
  assert.equal(selectorForFeature('kiez', null), null)
})

// ── Aggregation ──────────────────────────────────────────────────────────────
test('aggregate summiert die Mitglieds-PLRs einer Kiez-Gruppe (inkl. Altersstruktur)', () => {
  const a = aggregate(DATA, FC, { kind: 'gid', v: 'k1' })
  assert.equal(a.pop, 3000)
  assert.equal(a.m2, 1000000)
  assert.equal(a.n, 2)
  assert.equal(a.partial, false)
  // Ø-Alter aggregiert über die ALTERSSUMMEN, nicht als Mittel der Mittel:
  // (40000 + 90000) / 3000 = 43,33 — NICHT (40+45)/2 = 42,5
  assert.ok(Math.abs(a.avgAge - 130000 / 3000) < 1e-9)
  assert.equal(a.u18, 450)
  assert.equal(a.o65, 500)
})

test('aggregate über Präfixe: BZR und Bezirk', () => {
  assert.equal(aggregate(DATA, FC, { kind: 'prefix', v: '080101' }).pop, 3000)
  const bez = aggregate(DATA, FC, { kind: 'prefix', v: '08' })
  assert.equal(bez.pop, 7000)
  assert.equal(bez.m2, 2000000)
  assert.equal(bez.n, 3)
})

test('aggregate: anonymisierte PLRs → partial (Summe = Untergrenze) bzw. pop null', () => {
  const bez01 = aggregate(DATA, FC, { kind: 'prefix', v: '01' })
  assert.equal(bez01.pop, 500)      // NA zählt nicht mit …
  assert.equal(bez01.partial, true) // … wird aber ausgewiesen
  const k3 = aggregate(DATA, FC, { kind: 'gid', v: 'k3' })
  assert.equal(k3.pop, null)        // ausschließlich NA → keine Zahl erfinden
  assert.equal(k3.m2, 200000)       // Fläche ist trotzdem amtlich
  assert.equal(k3.avgAge, null)     // ohne Einwohner auch kein Alter
})

// [miete €/m², brw €/m²] je PLR (preise.json-Form)
const PREISE = { standMiete: '2022', standBrw: '01.01.2026', plr: {
  '08010101': [10, 2000],
  '08010102': [13, 3500],
  '08020201': [null, 1000], // Miete fehlt (kein Wohnatlas-Wert), BRW da
  '01011101': [9.5, null],  // NA-Einwohner → Flächengewicht
  '01011102': [8, 1200],
} }

test('aggregate mit Preisen: EINWOHNERGEWICHTETE Mittel, nicht Mittel der Mittel', () => {
  const k1 = aggregate(DATA, FC, { kind: 'gid', v: 'k1' }, PREISE)
  // Miete: (10×1000 + 13×2000) / 3000 = 12 — ungewichtet wären es 11,5
  assert.ok(Math.abs(k1.miete - 12) < 1e-9)
  // BRW: (2000×1000 + 3500×2000) / 3000 = 3000
  assert.ok(Math.abs(k1.brw - 3000) < 1e-9)
  // Bezirk 08: PLR ohne Miete zählt für Miete nicht mit, für BRW schon
  const bez = aggregate(DATA, FC, { kind: 'prefix', v: '08' }, PREISE)
  assert.ok(Math.abs(bez.miete - 12) < 1e-9)              // nur k1-Mitglieder tragen Miete
  assert.ok(Math.abs(bez.brw - (2000 * 1000 + 3500 * 2000 + 1000 * 4000) / 7000) < 1e-9)
})

test('aggregate mit Preisen: anonymisierte PLRs wiegen mit ihrer Fläche', () => {
  // Bezirk 01: 01011101 (NA, 200000 m² → Gewicht 20) + 01011102 (pop 500)
  const bez01 = aggregate(DATA, FC, { kind: 'prefix', v: '01' }, PREISE)
  const expected = (9.5 * 20 + 8 * 500) / 520
  assert.ok(Math.abs(bez01.miete - expected) < 1e-9)
  assert.ok(Math.abs(bez01.brw - 1200) < 1e-9) // nur 01011102 hat einen BRW
})

test('aggregate ohne preise-Daten → miete/brw null (abwärtskompatibel)', () => {
  const a = aggregate(DATA, FC, { kind: 'gid', v: 'k1' })
  assert.equal(a.miete, null)
  assert.equal(a.brw, null)
})

test('aggregate ohne Altersdaten (ältere stats.json) → Alters-Felder null', () => {
  const OLD = { stand: 'x', plr: { '08010101': [1000, 500000] } } // 2er-Arrays
  const a = aggregate(OLD, FC, { kind: 'plr', v: '08010101' })
  assert.equal(a.pop, 1000)
  assert.equal(a.avgAge, null)
  assert.equal(a.u18, null)
})

test('aggregate: kein Treffer/fehlende Inputs → null', () => {
  assert.equal(aggregate(DATA, FC, { kind: 'gid', v: 'nope' }), null)
  assert.equal(aggregate(null, FC, { kind: 'gid', v: 'k1' }), null)
  assert.equal(aggregate(DATA, FC, null), null)
})

// ── Ränge ────────────────────────────────────────────────────────────────────
test('ranksFor: Kiez-Ebene rankt nach Einwohnern und Dichte (NA-Einheiten außen vor)', () => {
  clearRankCache()
  // k2: 4000 Einw., 4,0/1000m² · k1: 3000, 3,0 · k4: 500, ~1,67 · k3: nur NA → raus
  const k1 = ranksFor(DATA, FC, 'kiez', { kind: 'gid', v: 'k1' })
  assert.deepEqual(k1, { popRank: 2, densRank: 2, of: 3 })
  const k4 = ranksFor(DATA, FC, 'kiez', { kind: 'gid', v: 'k4' })
  assert.equal(k4.popRank, 3)
  // die rein anonymisierte Einheit hat keinen Rang
  assert.equal(ranksFor(DATA, FC, 'kiez', { kind: 'gid', v: 'k3' }), null)
})

test('ranksFor: Bezirks-Ebene (partial zählt mit seiner Untergrenze)', () => {
  clearRankCache()
  const bez08 = ranksFor(DATA, FC, 'bez', { kind: 'prefix', v: '08' })
  assert.deepEqual(bez08, { popRank: 1, densRank: 1, of: 2 })
  assert.equal(ranksFor(DATA, FC, 'bez', { kind: 'prefix', v: '01' }).popRank, 2)
})

// ── geodätische Fläche (feine OSM-Kieze) ─────────────────────────────────────
const sq = (minX, minY, maxX, maxY) => [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]

test('geodesicAreaM2: 0,01°-Quadrat auf Berliner Breite ≈ 754.000 m²', () => {
  // 0,01° lon × cos(52,5°) × 111320 ≈ 677,6 m · 0,01° lat ≈ 1113,2 m
  const a = geodesicAreaM2({ type: 'Polygon', coordinates: sq(13.40, 52.495, 13.41, 52.505) })
  const expected = 0.01 * 111320 * Math.cos(52.5 * Math.PI / 180) * 0.01 * 111320
  assert.ok(Math.abs(a - expected) / expected < 0.01, `${a} vs ${expected}`)
})

test('geodesicAreaM2: Löcher werden abgezogen, MultiPolygon summiert, null → 0', () => {
  const outer = sq(13.0, 52.0, 13.1, 52.1)[0]
  const hole = sq(13.02, 52.02, 13.04, 52.04)[0]
  const withHole = geodesicAreaM2({ type: 'Polygon', coordinates: [outer, hole] })
  const solid = geodesicAreaM2({ type: 'Polygon', coordinates: [outer] })
  assert.ok(withHole < solid && withHole > 0)
  const multi = geodesicAreaM2({ type: 'MultiPolygon', coordinates: [sq(13.0, 52.0, 13.05, 52.05), sq(13.2, 52.2, 13.25, 52.25)] })
  assert.ok(Math.abs(multi - 2 * geodesicAreaM2({ type: 'Polygon', coordinates: sq(13.0, 52.0, 13.05, 52.05) })) / multi < 0.01)
  assert.equal(geodesicAreaM2(null), 0)
  assert.equal(geodesicAreaM2({ type: 'Point', coordinates: [13, 52] }), 0)
})

// ── Wikipedia-Lookups ────────────────────────────────────────────────────────
test('infoFor / infoForBezirk: Treffer, Miss und fehlende Daten', () => {
  const info = { info: { Reuterkiez: { t: 'Reuterkiez', x: '…', u: 'https://de.wikipedia.org/…' }, 'bez:Neukölln': { t: 'Bezirk Neukölln', x: '…', u: '…' } } }
  assert.equal(infoFor(info, 'Reuterkiez').t, 'Reuterkiez')
  assert.equal(infoForBezirk(info, 'Neukölln').t, 'Bezirk Neukölln')
  assert.equal(infoFor(info, 'Gibtsnichtkiez'), null)
  assert.equal(infoFor(null, 'Reuterkiez'), null)
  assert.equal(infoFor(info, null), null)
})

// ── Formatierung ─────────────────────────────────────────────────────────────
test('fmtInt / fmtKm2 / fmtDichte formatieren de-DE', () => {
  assert.equal(fmtInt(3913644), '3.913.644')
  assert.equal(fmtKm2(470000), '0,47 km²')   // < 1 km² → 2 Nachkommastellen
  assert.equal(fmtKm2(4560000), '4,6 km²')   // < 10 km² → 1
  assert.equal(fmtKm2(89100000), '89 km²')   // sonst ganzzahlig
  assert.equal(fmtDichte(3000, 1000000), '3.000')
  assert.equal(fmtDichte(null, 1000000), null)
  assert.equal(fmtDichte(3000, 0), null)
})

test('fmtAlter / fmtAnteil / fmtEuroM2: de-DE, null-sicher', () => {
  assert.equal(fmtAlter(42.933), '42,9 J.')
  assert.equal(fmtAlter(null), null)
  assert.equal(fmtAnteil(450, 3000), '15 %')
  assert.equal(fmtAnteil(500, 3000), '17 %') // kaufmännisch gerundet
  assert.equal(fmtAnteil(null, 3000), null)
  assert.equal(fmtAnteil(450, 0), null)
  assert.equal(fmtEuroM2(11.887, 2), '11,89 €/m²')
  assert.equal(fmtEuroM2(2770.4), '2.770 €/m²')
  assert.equal(fmtEuroM2(null), null)
})
