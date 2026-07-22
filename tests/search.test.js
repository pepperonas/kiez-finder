// Unit tests for src/search.js — the Berlin-tuned fuzzy place search:
// diacritic/ß/"straße" folding + the multi-tier scorer (exact → prefix →
// word-prefix → substring → subsequence → typo) + type-priority + dedup.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { norm, buildSearchIndex, search } from '../src/search.js'

// ── norm() folding ───────────────────────────────────────────────────────────
test('norm folds case, diacritics, ß and "straße"→"str"', () => {
  assert.equal(norm('Neukölln'), 'neukolln')
  assert.equal(norm('Müllerstraße'), 'mullerstr')
  assert.equal(norm('Schloß'), 'schloss')          // ß→ss, not a "straße"
  assert.equal(norm('Karl-Marx-Straße'), 'karl marx str')
  assert.equal(norm('  A.B/C  '), 'a b c')          // separators → spaces, trimmed
  assert.equal(norm(''), '')
  assert.equal(norm(null), '')
})

// ── a small synthetic index shared by the search tests ───────────────────────
const fc = (features) => ({ type: 'FeatureCollection', features })
const feat = (properties) => ({ type: 'Feature', properties, geometry: null })

buildSearchIndex({
  bez: fc([feat({ bez: '08 - Neukölln' }), feat({ bez: '01 - Mitte' })]),
  bzr: fc([
    feat({ bzr_name: 'Reuterstraße', bez: '08 - Neukölln' }),
    feat({ bzr_name: 'Neuköllner Mitte/Zentrum', bez: '08 - Neukölln' }),
  ]),
  pgr: fc([
    feat({ pgr_name: 'Neukölln', bez: '08 - Neukölln' }), // == Bezirk → skipped
    feat({ pgr_name: 'Gropiusstadt Nord', bez: '08 - Neukölln' }), // distinct → indexed
  ]),
  areas: fc([feat({ kiez: 'Reuterkiez', gid: 1 }), feat({ kiez: 'Schillerkiez', gid: 2 })]),
  osmKieze: fc([feat({ name: 'Reuterkiez' })]), // same name as an area → dedup to one
  kieze: fc([
    feat({ gid: 1, bez: '08 - Neukölln', plr_name: 'Reuterkiezplatz', bzr_name: 'Reuterstraße' }),
    feat({ gid: 2, bez: '08 - Neukölln', plr_name: 'Schillerpromenade', bzr_name: 'Schillerpromenade' }),
  ]),
  streets: [
    { name: 'Sonnenallee', bez: 'Neukölln', pt: [13.45, 52.47], bbox: [13.42, 52.46, 13.48, 52.49] },
    { name: 'Hauptstraße', bez: 'Pankow', pt: [13.43, 52.6], bbox: [13.42, 52.59, 13.44, 52.61] },
    { name: 'Hauptstraße', bez: 'Spandau', pt: [13.14, 52.53], bbox: [13.13, 52.52, 13.15, 52.54] },
    { name: 'Reuterkiez', bez: 'Neukölln', pt: [13.43, 52.49], bbox: [13.42, 52.48, 13.44, 52.5] }, // street named like a Kiez
    { name: 'Doppelort', bez: 'Mitte', pt: [13.40, 52.50], bbox: [13.39, 52.49, 13.41, 52.51] }, // street named like the POIs below
  ],
  pois: [
    { qid: 151356, name: 'Berliner Fernsehturm', desc: 'Turm in Berlin', lon: 13.409, lat: 52.52 },
    { qid: 2, name: 'Schillerkiez', desc: 'Ein Ort namens wie ein Kiez', lon: 13.42, lat: 52.47 }, // POI named like a Kiez → priority test
    { qid: 900, name: 'Doppelort', desc: 'Standort A', lon: 13.40, lat: 52.50 }, // same name…
    { qid: 901, name: 'Doppelort', desc: 'Standort B', lon: 13.50, lat: 52.55 }, // …different place → both stay (no dedup)
    { qid: 902, name: 'Ohnebeschreibung', lon: 13.41, lat: 52.49 }, // no desc → sub falls back to "Ort"
  ],
})

test('POI-Suche ist faltungs-unempfindlich (Kleinschreibung, keine Diakritika/ß)', () => {
  assert.equal(search('fernsehturm', 5)[0].type, 'poi') // Wort-Präfix auf „Fernsehturm"
})

test('gleichnamige POIs bleiben separate Treffer (nicht dedupliziert, distinkte qids)', () => {
  const hits = search('Doppelort', 8).filter((h) => h.type === 'poi')
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map((h) => h.qid).sort((a, b) => a - b), [900, 901])
})

test('POI ohne Beschreibung → Sub-Zeile fällt auf "Ort" zurück', () => {
  const hit = search('Ohnebeschreibung', 5).find((h) => h.type === 'poi')
  assert.equal(hit.sub, 'Ort')
})

test('ein POI schlägt auch eine gleichnamige Straße (Typ-Priorität 7 > 1)', () => {
  const hits = search('Doppelort', 8)
  const firstPoi = hits.findIndex((h) => h.type === 'poi')
  const firstStr = hits.findIndex((h) => h.type === 'str')
  assert.ok(firstPoi >= 0 && firstStr >= 0, 'POI und Straße beide gefunden')
  assert.ok(firstPoi < firstStr, 'POI rankt vor der gleichnamigen Straße')
})

test('POIs sind suchbar und tragen qid + Punkt statt eines Features', () => {
  const [top] = search('Fernsehturm', 5)
  assert.equal(top.type, 'poi')
  assert.equal(top.qid, 151356)
  assert.equal(top.feature, null)
  assert.deepEqual(top.pt, [13.409, 52.52])
  assert.equal(top.typeLabel, 'Ort')
})

test('ein POI hat Vorrang vor einem gleichnamigen Kiez (Typ-Priorität)', () => {
  const hits = search('Schillerkiez', 5)
  assert.equal(hits[0].type, 'poi') // prio 7 > kiez prio 5
  assert.ok(hits.some((h) => h.type === 'kiez')) // der Kiez ist weiterhin da
})

test('empty query returns nothing', () => {
  assert.deepEqual(search(''), [])
  assert.deepEqual(search('   '), [])
})

test('exact match ranks first', () => {
  const top = search('Mitte')[0]
  assert.equal(top.label, 'Mitte')
  assert.equal(top.type, 'bez')
})

test('a prefix query surfaces the Bezirk exact-match on top', () => {
  const top = search('Neukölln')[0]
  assert.equal(top.label, 'Neukölln')
  assert.equal(top.type, 'bez')
})

test('a Prognoseraum that differs from its Bezirk is indexed and findable', () => {
  const top = search('Gropiusstadt')[0]
  assert.equal(top.label, 'Gropiusstadt Nord')
  assert.equal(top.type, 'pgr')
  assert.equal(top.typeLabel, 'Prognoseraum')
  assert.equal(top.sub, 'Neukölln')
})

test('type priority breaks ties (Kiez > Bezirksregion > Planungsraum)', () => {
  // "reuter" prefixes Reuterkiez (kiez), Reuterstraße (bzr) and Reuterkiezplatz (plr)
  const top = search('Reuter')[0]
  assert.equal(top.label, 'Reuterkiez')
  assert.equal(top.type, 'kiez')
})

test('duplicate name+type is de-duplicated (OSM Kiez vs merged area)', () => {
  const hits = search('Reuterkiez').filter((r) => r.label === 'Reuterkiez' && r.type === 'kiez')
  assert.equal(hits.length, 1)
})

test('a Prognoseraum equal to its Bezirk is not indexed', () => {
  const pgrHits = search('Neukölln').filter((r) => r.type === 'pgr')
  assert.equal(pgrHits.length, 0)
})

test('search is fold-insensitive (no umlaut / no ß in the query)', () => {
  assert.ok(search('neukolln').some((r) => r.label === 'Neukölln'))
  assert.ok(search('reuterstrasse').some((r) => r.label === 'Reuterstraße'))
})

test('typo tolerance finds a near-miss (bounded Levenshtein)', () => {
  assert.ok(search('Reuterkietz').some((r) => r.label === 'Reuterkiez')) // 1 edit
})

test('search respects the result limit', () => {
  assert.ok(search('e', 3).length <= 3)
})

// ── streets ──────────────────────────────────────────────────────────────────
test('streets are searchable and carry point + bbox instead of a feature', () => {
  const hit = search('Sonnenallee')[0]
  assert.equal(hit.type, 'str')
  assert.equal(hit.label, 'Sonnenallee')
  assert.equal(hit.sub, 'Neukölln')
  assert.deepEqual(hit.pt, [13.45, 52.47])
  assert.equal(hit.bbox.length, 4)
  assert.equal(hit.feature, null)
})

test('same-named streets in different Bezirken stay separate entries', () => {
  const hits = search('Hauptstraße').filter((r) => r.type === 'str')
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map((r) => r.sub).sort(), ['Pankow', 'Spandau'])
})

test('a Kiez outranks a same-named street (type priority)', () => {
  const top = search('Reuterkiez')[0]
  assert.equal(top.type, 'kiez')
})

test('street search folds "straße" in the query', () => {
  assert.ok(search('sonnenallee').some((r) => r.type === 'str'))
  assert.ok(search('hauptstrasse').some((r) => r.type === 'str'))
  assert.ok(search('hauptstr').some((r) => r.type === 'str'))
})

// ── city-aware Labels (Frankfurt: Stadtteil/Ortsbezirk) ──
// MUSS am Dateiende stehen: baut den Index neu → alle Tests danach würden ihn sehen.
test('buildSearchIndex: city labels override the type labels + defaultSub for streets', () => {
  buildSearchIndex({
    bez: fc([feat({ bez: '01 - Innenstadt I' })]),
    areas: fc([feat({ kiez: 'Bornheim', gid: 1 })]),
    kieze: fc([feat({ gid: 1, bez: '04 - Bornheim/Ostend', plr_name: 'Bornheim', bzr_name: null })]),
    streets: [{ name: 'Zeil', bez: '', pt: [8.68, 50.11], bbox: [8.67, 50.11, 8.69, 50.12] }],
    labels: { kiez: 'Stadtteil', bez: 'Ortsbezirk' },
    defaultSub: 'Frankfurt',
  })
  assert.equal(search('Bornheim')[0].typeLabel, 'Stadtteil') // kiez → Stadtteil
  assert.equal(search('Innenstadt')[0].typeLabel, 'Ortsbezirk') // bez → Ortsbezirk
  const zeil = search('Zeil')[0]
  assert.equal(zeil.typeLabel, 'Straße')
  assert.equal(zeil.sub, 'Frankfurt') // leerer Straßen-bez → defaultSub
})
