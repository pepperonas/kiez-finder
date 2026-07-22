// Unit tests for src/heat.js — Heatmap-Kern: Metrik-Katalog, Heat-FC-Join
// (fehlende Werte werden WEGGELASSEN, nicht genullt), Quantil-Klassengrenzen
// (schiefe Verteilungen, Duplikate), Klassenindex, MapLibre-Paint-Expression
// und Legenden-Daten. Alles pure mit injizierten Fixtures.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadPreise, preiseData, METRICS, metricByKey, standFor, buildHeatFC,
  quantileBreaks, classIndex, heatPaint, legendFor, RAMPS,
} from '../src/heat.js'

// ── Loader (fetch-Stub): memoisiert, Fehlschlag → null statt Throw ───────────
test('loadPreise lädt einmal, memoisiert und schluckt Fehler', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ standMiete: '2022', plr: {} }) } }
  try {
    const p1 = await loadPreise()
    const p2 = await loadPreise()
    assert.equal(p1, p2)
    assert.equal(p1.standMiete, '2022')
    assert.equal(preiseData(), p1)
    assert.equal(calls, 1) // Promise memoisiert → genau ein Fetch
  } finally { globalThis.fetch = realFetch }
})

const plr = (plr_id, kiez) => ({ type: 'Feature', properties: { plr_id, kiez }, geometry: { type: 'Polygon', coordinates: [] } })
const FC = { type: 'FeatureCollection', features: [plr('08010101', 'Testkiez'), plr('01011101', 'Anonkiez'), plr('99999999', 'Ohne')] }
const STATS = { stand: '31.12.2025', plr: {
  '08010101': [1000, 500000, 40000], // Dichte 2000, Ø 40
  '01011101': [null, 200000, null, null, null], // NA → keine Bevölkerungsmetriken
  // 99999999 fehlt komplett → Feature wird übersprungen
} }
const PREISE = { standMiete: '2022', standBrw: '01.01.2026', plr: {
  '08010101': [11.89, 2770],
  '01011101': [9.5, null], // Miete ja (kommt je Prognoseraum), BRW nein
} }

// ── Katalog + Stichtage ──────────────────────────────────────────────────────
test('METRICS: 4 Metriken, metricByKey findet + verfehlt korrekt', () => {
  assert.equal(METRICS.length, 4)
  assert.equal(metricByKey('dichte').unit, 'Einw./km²')
  assert.equal(metricByKey('brw').label, 'Bodenrichtwert Wohnen')
  assert.equal(metricByKey('off'), null)
  assert.equal(metricByKey(null), null)
})

test('standFor zieht den Stichtag aus der richtigen Quelle', () => {
  assert.equal(standFor(metricByKey('dichte'), STATS, PREISE), '31.12.2025')
  assert.equal(standFor(metricByKey('miete'), STATS, PREISE), '2022, Wohnatlas')
  assert.equal(standFor(metricByKey('brw'), STATS, PREISE), '01.01.2026')
  assert.equal(standFor(metricByKey('brw'), STATS, null), null)
})

// ── Heat-FC-Join ─────────────────────────────────────────────────────────────
test('buildHeatFC joint Metriken je PLR und lässt fehlende Werte WEG', () => {
  const fc = buildHeatFC(FC, STATS, PREISE)
  assert.equal(fc.features.length, 2) // 99999999 hat keine stats-Zeile → raus
  const a = fc.features[0].properties
  assert.equal(a.name, 'Testkiez')
  assert.ok(Math.abs(a.dichte - 2000) < 1e-9)
  assert.ok(Math.abs(a.alter - 40) < 1e-9)
  assert.equal(a.miete, 11.89)
  assert.equal(a.brw, 2770)
  const b = fc.features[1].properties
  assert.equal('dichte' in b, false) // NA-Bevölkerung → Property FEHLT (['has']-Check!)
  assert.equal('alter' in b, false)
  assert.equal(b.miete, 9.5)         // Miete gibt es trotzdem (Prognoseraum-Wert)
  assert.equal('brw' in b, false)
})

test('buildHeatFC ohne Preise/Stats bleibt null-sicher', () => {
  const fc = buildHeatFC(FC, STATS, null)
  assert.equal('miete' in fc.features[0].properties, false)
  assert.equal(buildHeatFC(null, STATS, PREISE), null)
  assert.equal(buildHeatFC(FC, null, PREISE), null)
})

// ── Quantil-Breaks ───────────────────────────────────────────────────────────
test('quantileBreaks: 7 Klassen → 6 Grenzen, gleichbesetzte Klassen bei Schiefe', () => {
  // stark schiefe Verteilung (wie Berliner Dichte): linear wäre fast einfarbig
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 100, 1000, 10000, 20000, 28000, 28500, 30000, 40000]
  const b = quantileBreaks(vals, 7)
  assert.equal(b.length, 6)
  assert.ok(b[0] < 100, 'unterste Grenzen bleiben im dichten Wertebereich')
  assert.ok(b[5] >= 10000, 'oberste Grenze trennt die Ausreißer-Klasse')
  for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1], 'streng steigend')
})

test('quantileBreaks: Duplikate werden dedupliziert, Kleinstmengen degradieren sauber', () => {
  const b = quantileBreaks([5, 5, 5, 5, 5, 5, 5, 9], 7)
  for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1]) // nie zwei gleiche Stops
  assert.deepEqual(quantileBreaks([], 7), [])
  assert.deepEqual(quantileBreaks([42], 7), [])
  assert.deepEqual(quantileBreaks([null, undefined, NaN, 3, 7], 7).every((x) => Number.isFinite(x)), true)
})

test('classIndex ordnet Werte in die Quantil-Klassen ein', () => {
  const b = [10, 20, 30]
  assert.equal(classIndex(5, b), 0)
  assert.equal(classIndex(10, b), 1)  // Grenze gehört zur höheren Klasse (>=)
  assert.equal(classIndex(25, b), 2)
  assert.equal(classIndex(99, b), 3)
})

// ── Paint-Expression + Legende ───────────────────────────────────────────────
test('heatPaint: ohne Daten transparent, sonst has→step mit Rampe', () => {
  const p = heatPaint('dichte', [10, 20], 'dark')
  assert.equal(p[0], 'case')
  assert.deepEqual(p[1], ['!', ['has', 'dichte']])
  assert.equal(p[2], 'rgba(0,0,0,0)')
  const step = p[3]
  assert.deepEqual(step.slice(0, 3), ['step', ['get', 'dichte'], RAMPS.dark[0]])
  assert.equal(step.length, 3 + 2 * 2) // 2 Breaks à (Stop, Farbe)
  assert.equal(heatPaint('dichte', [], 'dark'), 'rgba(0,0,0,0)') // degeneriert → unsichtbar
})

test('legendFor liefert Titel, formatiertes Min/Max und die Klassenfarben', () => {
  const leg = legendFor(metricByKey('dichte'), [10, 20], [5, 12, 28000], 'dark')
  assert.equal(leg.title, 'Bevölkerungsdichte')
  assert.equal(leg.min, '5')
  assert.equal(leg.max, '28.000') // de-DE
  assert.equal(leg.colors.length, 3) // Breaks + 1 Klassen
  assert.equal(legendFor(null, [10], [1], 'dark'), null)
  assert.equal(legendFor(metricByKey('dichte'), [], [1], 'dark'), null)
})

test('RAMPS: 7 Stufen je Theme, alles Hex-Farben', () => {
  for (const t of ['dark', 'light']) {
    assert.equal(RAMPS[t].length, 7)
    for (const c of RAMPS[t]) assert.match(c, /^#[0-9a-f]{6}$/i)
  }
})
