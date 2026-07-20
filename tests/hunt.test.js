// Unit tests for src/hunt.js — die Schnitzeljagd: Distanz/Umkreis, Fortschritt
// (lesen/schreiben/robust gegen Müll), idempotentes Besuchen, konfliktfreier
// Union-Merge (Vorbereitung auf Server-Sync), Auswertung je Kiez + Ränge.
// Alles pure mit injizierten Fixtures.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadPois, poisData,
  RADIUS_M, decodePoi, poiUrl, distanceM, poisNear, nearestPois, fmtDist,
  emptyProgress, readProgress, writeProgress, markVisited, mergeProgress,
  isVisited, overallProgress, scopeProgress, completedAreas, rankFor, RANKS,
} from '../src/hunt.js'

// Brandenburger Tor (52.5163, 13.3777) und Reichstag (52.5186, 13.3761) — ~270 m
const BRANDENBURGER_TOR = { qid: 82425, name: 'Brandenburger Tor', desc: 'Triumphtor', lon: 13.3777, lat: 52.5163, kat: 1, plr: '01011101', sl: 85, art: null }
const REICHSTAG = { qid: 156721, name: 'Reichstagsgebäude', desc: 'Bundestag', lon: 13.3761, lat: 52.5186, kat: 15, plr: '01011101', sl: 74, art: null }
const FERNSEHTURM = { qid: 43715, name: 'Berliner Fernsehturm', desc: 'Sendeturm', lon: 13.4094, lat: 52.5208, kat: 8, plr: '01011102', sl: 58, art: null }
const LIST = [BRANDENBURGER_TOR, REICHSTAG, FERNSEHTURM]

function stubStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }
}

// ── Loader (fetch-Stub): memoisiert, dekodiert, schluckt Fehler ─────────────
test('loadPois lädt einmal, dekodiert die Liste und memoisiert', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return { ok: true, json: async () => ({ stand: '2026-07-20', kat: ['Museum'],
      pois: [[82425, 'Brandenburger Tor', 'Triumphtor', 13.3777, 52.5163, 1, '01011101', 85, 0]] }) }
  }
  try {
    const d1 = await loadPois()
    const d2 = await loadPois()
    assert.equal(d1, d2)
    assert.equal(calls, 1)
    assert.equal(d1.list.length, 1)
    assert.equal(d1.list[0].name, 'Brandenburger Tor') // dekodiert, nicht roh
    assert.equal(poisData(), d1)
  } finally { globalThis.fetch = realFetch }
})

// ── Dekodierung ──────────────────────────────────────────────────────────────
test('decodePoi liest das kompakte Array-Format, poiUrl nutzt den Artikel-Titel', () => {
  const p = decodePoi([82425, 'Brandenburger Tor', 'Triumphtor', 13.3777, 52.5163, 1, '01011101', 85, 0])
  assert.equal(p.qid, 82425)
  assert.equal(p.name, 'Brandenburger Tor')
  assert.equal(p.plr, '01011101')
  assert.equal(p.art, null) // 0 → null
  assert.equal(poiUrl(p), 'https://de.wikipedia.org/wiki/Brandenburger_Tor')
  // abweichender Artikel-Titel gewinnt
  assert.equal(poiUrl({ name: 'Zoo', art: 'Zoologischer Garten Berlin' }),
    'https://de.wikipedia.org/wiki/Zoologischer_Garten_Berlin')
})

// ── Distanz + Umkreis ────────────────────────────────────────────────────────
test('distanceM: 0 bei Identität, ~270 m Tor→Reichstag, symmetrisch', () => {
  assert.equal(distanceM(52.5163, 13.3777, 52.5163, 13.3777), 0)
  const d = distanceM(52.5163, 13.3777, 52.5186, 13.3761)
  assert.ok(d > 240 && d < 300, `erwartet ~270 m, war ${Math.round(d)} m`)
  assert.ok(Math.abs(d - distanceM(52.5186, 13.3761, 52.5163, 13.3777)) < 1e-6)
})

test('poisNear findet nur POIs im Radius, sortiert nach Entfernung', () => {
  // direkt am Brandenburger Tor: Tor sofort, Reichstag erst mit größerem Radius
  const near = poisNear(LIST, 52.5163, 13.3777)
  assert.equal(near.length, 1)
  assert.equal(near[0].poi.qid, BRANDENBURGER_TOR.qid)
  const wider = poisNear(LIST, 52.5163, 13.3777, 400)
  assert.deepEqual(wider.map((h) => h.poi.qid), [BRANDENBURGER_TOR.qid, REICHSTAG.qid]) // nach Distanz
  // Fernsehturm ist ~2 km weg → auch mit 400 m nicht dabei
  assert.equal(wider.some((h) => h.poi.qid === FERNSEHTURM.qid), false)
  assert.deepEqual(poisNear(LIST, 52.4, 13.5), []) // weit weg
  assert.deepEqual(poisNear(null, 52.5, 13.4), []) // ohne Daten
})

test('RADIUS_M ist großzügig genug für GPS-Drift, aber kein Freifahrtschein', () => {
  assert.ok(RADIUS_M >= 100 && RADIUS_M <= 250)
})

test('nearestPois liefert die nächsten Ziele ohne Radiusgrenze (leere Kieze)', () => {
  // vom Fernsehturm aus: Reichstag/Tor sind ~2 km weg — poisNear fände nichts
  const near = nearestPois(LIST, 52.5208, 13.4094, 2)
  assert.equal(near.length, 2)
  assert.equal(near[0].poi.qid, FERNSEHTURM.qid) // er selbst zuerst (Distanz 0)
  assert.ok(near[1].dist > near[0].dist, 'aufsteigend nach Entfernung')
  assert.equal(nearestPois([], 52.5, 13.4).length, 0)
  assert.equal(nearestPois(null, 52.5, 13.4).length, 0)
})

test('fmtDist: Meter gerundet, ab 1 km in Kilometern (de-DE)', () => {
  assert.equal(fmtDist(0), '0 m')
  assert.equal(fmtDist(483), '480 m')
  assert.equal(fmtDist(999), '1000 m')
  assert.equal(fmtDist(2340), '2,3 km')
  assert.equal(fmtDist(null), '')
  assert.equal(fmtDist(NaN), '')
})

// ── Fortschritt lesen/schreiben ──────────────────────────────────────────────
test('readProgress: leer, gültig, und robust gegen Müll', () => {
  assert.deepEqual(readProgress(stubStorage()), emptyProgress())
  const ok = readProgress(stubStorage({ 'kf-hunt': JSON.stringify({ v: 1, visited: { 42: 1700000000000 } }) }))
  assert.equal(ok.visited[42], 1700000000000)
  for (const junk of ['null', '[]', '{}', 'nicht json', '{"visited":"kaputt"}']) {
    assert.deepEqual(readProgress(stubStorage({ 'kf-hunt': junk })), emptyProgress(), junk)
  }
  // unsinnige Einträge werden gefiltert, gültige behalten
  const mixed = readProgress(stubStorage({ 'kf-hunt': '{"visited":{"7":123,"abc":456,"9":"nope"}}' }))
  assert.deepEqual(mixed.visited, { 7: 123 })
  assert.deepEqual(readProgress({ getItem() { throw new Error('x') } }), emptyProgress())
})

test('writeProgress schluckt eine werfende Storage', () => {
  const p = emptyProgress()
  assert.equal(writeProgress({ setItem() { throw new Error('quota') } }, p), p)
  const s = stubStorage()
  writeProgress(s, { v: 1, visited: { 5: 1 } })
  assert.equal(JSON.parse(s.getItem('kf-hunt')).visited[5], 1)
})

// ── Besuchen ─────────────────────────────────────────────────────────────────
test('markVisited ist idempotent — der ERSTE Besuch zählt', () => {
  const p0 = emptyProgress()
  const r1 = markVisited(p0, 82425, 1000)
  assert.equal(r1.changed, true)
  assert.equal(r1.progress.visited[82425], 1000)
  assert.deepEqual(p0.visited, {}, 'Original bleibt unangetastet (immutable)')
  const r2 = markVisited(r1.progress, 82425, 9999)
  assert.equal(r2.changed, false)
  assert.equal(r2.progress.visited[82425], 1000, 'späterer Besuch überschreibt nicht')
})

// ── Merge (Server-Sync-Vorbereitung) ─────────────────────────────────────────
test('mergeProgress: Union, früherer Zeitstempel gewinnt, kommutativ + idempotent', () => {
  const a = { v: 1, visited: { 1: 500, 2: 800 } }
  const b = { v: 1, visited: { 2: 300, 3: 900 } }
  const ab = mergeProgress(a, b), ba = mergeProgress(b, a)
  assert.deepEqual(ab.visited, { 1: 500, 2: 300, 3: 900 }) // 2: der frühere Erstbesuch
  assert.deepEqual(ab, ba, 'kommutativ')
  assert.deepEqual(mergeProgress(ab, ab), ab, 'idempotent')
  assert.deepEqual(mergeProgress(a, null).visited, a.visited)
  assert.deepEqual(mergeProgress(null, null), emptyProgress())
})

// ── Auswertung ───────────────────────────────────────────────────────────────
test('overallProgress zählt besuchte POIs + Prozent', () => {
  const p = { v: 1, visited: { [BRANDENBURGER_TOR.qid]: 1 } }
  assert.deepEqual(overallProgress(LIST, p), { total: 3, visited: 1, pct: 33 })
  assert.deepEqual(overallProgress(LIST, emptyProgress()), { total: 3, visited: 0, pct: 0 })
  assert.deepEqual(overallProgress([], emptyProgress()), { total: 0, visited: 0, pct: 0 })
  assert.equal(isVisited(p, BRANDENBURGER_TOR.qid), true)
  assert.equal(isVisited(p, FERNSEHTURM.qid), false)
})

test('scopeProgress wertet einen Kiez/Bezirk aus und erkennt „komplett"', () => {
  const plrs = new Set(['01011101']) // Tor + Reichstag
  const none = scopeProgress(LIST, emptyProgress(), plrs)
  assert.equal(none.total, 2)
  assert.equal(none.visited, 0)
  assert.equal(none.done, false)
  const half = scopeProgress(LIST, { v: 1, visited: { [BRANDENBURGER_TOR.qid]: 1 } }, plrs)
  assert.equal(half.visited, 1)
  assert.equal(half.done, false)
  const all = scopeProgress(LIST, { v: 1, visited: { [BRANDENBURGER_TOR.qid]: 1, [REICHSTAG.qid]: 2 } }, plrs)
  assert.equal(all.done, true)
  // Bereich ohne POIs gilt NICHT als komplett (sonst wären leere Kieze „geschafft")
  const empty = scopeProgress(LIST, emptyProgress(), new Set(['09999999']))
  assert.equal(empty.total, 0)
  assert.equal(empty.done, false)
})

test('completedAreas zählt nur Bereiche, die überhaupt POIs haben', () => {
  const areas = new Map([
    ['g1', new Set(['01011101'])], // 2 POIs
    ['g2', new Set(['01011102'])], // 1 POI
    ['g3', new Set(['07000000'])], // keine POIs → zählt nicht mit
  ])
  const p = { v: 1, visited: { [FERNSEHTURM.qid]: 1 } }
  assert.deepEqual(completedAreas(LIST, p, areas), { done: 1, withPois: 2 })
})

// ── Ränge ────────────────────────────────────────────────────────────────────
test('rankFor liefert Titel + Rest bis zum nächsten Rang', () => {
  const r0 = rankFor(0)
  assert.equal(r0.title, 'Neu in der Stadt')
  assert.equal(r0.next.title, 'Tourist')
  assert.equal(r0.toNext, 5)
  assert.equal(rankFor(30).title, 'Zugezogen')
  assert.equal(rankFor(75).title, 'Kiezgänger') // Grenze gehört zum höheren Rang
  const top = rankFor(1000)
  assert.equal(top.title, 'Berlin-Legende')
  assert.equal(top.next, null)
  assert.equal(top.toNext, 0)
  assert.ok(RANKS.every((r, i) => i === 0 || r.at > RANKS[i - 1].at), 'Schwellen streng steigend')
})
