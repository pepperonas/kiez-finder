// Dataset tests for public/data/darmstadt/* — boundaries, stats, streets, POIs.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const load = (f) => JSON.parse(readFileSync(new URL(`../public/data/darmstadt/${f}`, import.meta.url), 'utf8'))
const kieze = load('kieze.geojson')
const bezirke = load('bezirke.geojson')
const stats = load('stats.json')
const strassen = load('strassen.json')
const pois = load('pois.json')
const preise = load('preise.json')
const kiezInfo = load('kiez-info.json')

test('kieze: 37 Viertel im App-Schema (plr_id/gid/kiez/bez, Polygon)', () => {
  assert.equal(kieze.features.length, 37)
  for (const f of kieze.features) {
    const p = f.properties
    assert.match(p.plr_id, /^\d{4}$/)
    assert.equal(p.gid, p.plr_id)
    assert.ok(p.kiez && p.plr_name)
    assert.match(p.bez, /^\d{2} - .+/)
    assert.ok(f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  }
  assert.equal(new Set(kieze.features.map((f) => f.properties.plr_id)).size, 37)
  assert.equal(new Set(kieze.features.map((f) => f.properties.kiez)).size, 37)
  assert.ok(kieze.features.some((f) => f.properties.kiez === 'Stadtzentrum'))
})

test('bezirke: 9 Stadtteile, ids sind die plr_id-Präfixe', () => {
  assert.equal(bezirke.features.length, 9)
  const bezIds = new Set(bezirke.features.map((f) => f.properties.id))
  for (const f of kieze.features) {
    assert.ok(bezIds.has(f.properties.plr_id.slice(0, 2)), `ST für ${f.properties.kiez}`)
  }
  assert.deepEqual([...bezIds].sort(), ['01', '02', '03', '04', '05', '06', '07', '08', '09'])
})

test('stats: 37 Einträge [einwohner, m2, alterssumme], konsistent zu kieze', () => {
  assert.equal(Object.keys(stats.plr).length, 37)
  let total = 0
  for (const f of kieze.features) {
    const row = stats.plr[f.properties.plr_id]
    assert.ok(row, `stats für ${f.properties.kiez}`)
    assert.equal(row.length, 3)
    assert.ok(row[0] > 0)
    assert.ok(row[1] > 0)
    assert.equal(row[2], null)
    total += row[0]
  }
  assert.ok(total > 160000 && total < 190000, `Darmstadt-Summe ${total} plausibel`)
  assert.match(stats.stand, /2025/)
})

test('strassen: Index-Form + bekannte Darmstädter Straßen', () => {
  assert.equal(strassen.v, 1)
  assert.equal(strassen.bez.length, 9)
  assert.ok(strassen.streets.length > 800)
  const names = new Set(strassen.streets.map((s) => s[0]))
  for (const n of ['Rheinstraße', 'Luisenplatz']) assert.ok(names.has(n), n)
  for (const s of strassen.streets.slice(0, 100)) {
    assert.equal(s.length, 8)
    assert.ok(s[1] >= -1 && s[1] < 9)
  }
})

test('preise: Bodenrichtwerte je Viertel (miete=null, brw plausibel)', () => {
  assert.equal(preise.standMiete, null)
  assert.match(preise.standBrw, /2024/)
  assert.equal(Object.keys(preise.plr).length, 37)
  let brwN = 0
  for (const [id, row] of Object.entries(preise.plr)) {
    assert.equal(row.length, 2)
    assert.equal(row[0], null)
    if (row[1] != null) { assert.ok(row[1] > 200 && row[1] < 8000); brwN++ }
  }
  assert.ok(brwN >= 30, `BRW-Abdeckung ${brwN}/37`)
})

test('pois: ~120 Schnitzeljagd-Ziele mit Verortung + Flagships', () => {
  assert.ok(pois.pois.length >= 100 && pois.pois.length <= 140)
  assert.ok(pois.kat.length >= 10)
  const plrIds = new Set(kieze.features.map((f) => f.properties.plr_id))
  const byBez = new Map()
  for (const p of pois.pois) {
    assert.equal(p.length, 10) // inkl. facts
    assert.ok(p[1])
    assert.ok(plrIds.has(p[6]), `POI ${p[1]} verortet`)
    assert.ok(p[3] > 8.55 && p[3] < 8.76 && p[4] > 49.79 && p[4] < 49.96) // DA-Bbox
    const bez = String(p[6]).slice(0, 2)
    byBez.set(bez, (byBez.get(bez) || 0) + 1)
  }
  // Quote: nicht alles in Mitte — mind. 5 Stadtteile mit ≥1 POI
  assert.ok(byBez.size >= 5, `POI-Stadtteile ${byBez.size}`)
  const names = new Set(pois.pois.map((p) => p[1]))
  for (const n of ['Waldspirale', 'Hessisches Landesmuseum Darmstadt', 'Darmstadt Hauptbahnhof']) {
    assert.ok(names.has(n), n)
  }
  assert.ok([...names].some((n) => /Mathildenhöhe/i.test(n)))
})

test('kiez-info: Beschreibungen für die meisten Viertel + alle Stadtteile', () => {
  assert.ok(kiezInfo.info)
  let viertel = 0, bez = 0
  for (const k of Object.keys(kiezInfo.info)) {
    if (k.startsWith('bez:')) bez++
    else viertel++
  }
  assert.ok(viertel >= 30, `${viertel} Viertel-Texte`)
  assert.equal(bez, 9)
  // Darmstadt-Relevanz: kein fremder Ort
  for (const [k, e] of Object.entries(kiezInfo.info)) {
    if (!e.x) continue
    assert.match(e.t + ' ' + e.x, /Darmstadt/i, k)
  }
})

test('kiez-img: Foto je Viertel (gid-keyed)', () => {
  const img = load('kiez-img.json')
  assert.equal(Object.keys(img.info).length, 37)
  for (const f of kieze.features) {
    const e = img.info[f.properties.gid]
    assert.ok(e, `Foto für ${f.properties.kiez}`)
    assert.equal(e.img, 1)
    assert.ok(e.credit)
  }
})

test('poi-info: Texte + Bild-Flag für (fast) alle POIs', () => {
  const info = load('poi-info.json').info || load('poi-info.json')
  // Format: { "<qid>": { t?, x?, img?, … } } oder verschachtelt
  const map = info.info || info
  let withText = 0, withImg = 0
  for (const p of pois.pois) {
    const e = map[String(p[0])] || map[p[0]]
    if (!e) continue
    if (e.x || e.t) withText++
    if (e.img) withImg++
  }
  assert.ok(withText >= 110, `Texte ${withText}/120`)
  assert.ok(withImg >= 115, `Bilder ${withImg}/120`)
})