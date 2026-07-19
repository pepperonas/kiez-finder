#!/usr/bin/env node
// Builds public/data/preise.json — zwei amtliche Preis-Indikatoren je
// LOR-Planungsraum für die Heatmap (beide Quellen: Lizenz dl-de-zero-2.0):
//
//  · miete: mittlere Angebotsmiete €/m² (netto kalt) je PROGNOSERAUM aus dem
//    Wohnatlas Berlin (wa_01_angebotsmieten, neuester Layer wa_01_2022) —
//    Join über prognoseraum_nummer = plr_id-Präfix (4), kein Geo-Processing.
//  · brw: mittlerer Bodenrichtwert €/m² für WOHNBAULAND (nutzung "W …") aus
//    BORIS (brw2026, Stichtag 01.01.2026, 1.623 Zonen). Je PLR über ein
//    Innenpunkt-Raster gemittelt (bbox-vorgefiltertes Point-in-Polygon in die
//    Zonen) — konvergiert gegen das flächengewichtete Mittel der W-Zonen;
//    PLRs ohne Wohnbauland-Treffer (Wald/Industrie/Flughafen) → null.
//
// Format: { standMiete, standBrw, quelle, plr: { "<plr_id>": [miete|null, brw|null] } }
// Usage: node tools/build-heat-prices.mjs   (holt beide WFS live, ~10-30 s)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WFS = (svc, type) =>
  `https://gdi.berlin.de/services/wfs/${svc}?service=WFS&version=2.0.0&request=GetFeature` +
  `&typeNames=${type}&outputFormat=application/json&srsName=EPSG:4326`

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json()
}

// ── Geometrie-Helfer (Ray-Cast, wie src/kiez.js) ─────────────────────────────
const ringsOf = (g) => g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
// even-odd über alle Ringe (Löcher zählen raus) — reicht für BRW-Zonen + PLRs
const inGeom = (pt, g) => {
  let ins = false
  for (const r of ringsOf(g)) if (inRing(pt, r)) ins = !ins
  return ins
}
function bboxOf(g) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const r of ringsOf(g)) for (const [x, y] of r) {
    if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y
  }
  return [x1, y1, x2, y2]
}

// ── 1) Angebotsmieten je Prognoseraum ────────────────────────────────────────
const MIETE_LAYER = 'wa_01_angebotsmieten:wa_01_2022'
const mietenFC = await fetchJSON(WFS('wa_01_angebotsmieten', MIETE_LAYER))
const mieteByPgr = new Map()
for (const f of mietenFC.features) {
  const p = f.properties
  if (p.prognoseraum_nummer && p.angebotsmieten != null)
    mieteByPgr.set(p.prognoseraum_nummer, p.angebotsmieten)
}
if (mieteByPgr.size !== 58) throw new Error(`Mieten: ${mieteByPgr.size} Prognoseräume statt 58`)

// ── 2) Bodenrichtwerte (Wohnbauland) ─────────────────────────────────────────
const brwFC = await fetchJSON(WFS('brw2026', 'brw2026:brw2026_vector'))
const wZones = brwFC.features
  .filter((f) => f.properties.brw != null && /^W\b/.test(f.properties.nutzung || ''))
  .map((f) => ({ brw: f.properties.brw, geom: f.geometry, bb: bboxOf(f.geometry) }))
if (wZones.length < 500) throw new Error(`BRW: nur ${wZones.length} W-Zonen — Filter/Quelle prüfen`)

const kieze = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
if (kieze.features.length !== 542) throw new Error('kieze.geojson ≠ 542 PLRs')

function brwFor(plrGeom) {
  const [x1, y1, x2, y2] = bboxOf(plrGeom)
  const N = 8 // 8×8-Innenpunkt-Raster je PLR
  const hits = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = x1 + (x2 - x1) * (i + 0.5) / N
    const y = y1 + (y2 - y1) * (j + 0.5) / N
    if (!inGeom([x, y], plrGeom)) continue
    for (const z of wZones) {
      if (x < z.bb[0] || x > z.bb[2] || y < z.bb[1] || y > z.bb[3]) continue
      if (inGeom([x, y], z.geom)) { hits.push(z.brw); break }
    }
  }
  if (!hits.length) return null
  return Math.round(hits.reduce((a, b) => a + b, 0) / hits.length)
}

// ── zusammenführen + validieren ──────────────────────────────────────────────
const plr = {}
let mieteN = 0, brwN = 0
for (const f of kieze.features) {
  const id = f.properties.plr_id
  const miete = mieteByPgr.get(id.substring(0, 4)) ?? null
  const brw = brwFor(f.geometry)
  plr[id] = [miete, brw]
  if (miete != null) mieteN++
  if (brw != null) brwN++
}
if (mieteN < 500) throw new Error(`Mieten-Abdeckung nur ${mieteN}/542`)
if (brwN < 400) throw new Error(`BRW-Abdeckung nur ${brwN}/542`)
const brwVals = Object.values(plr).map((r) => r[1]).filter((v) => v != null).sort((a, b) => a - b)
const med = brwVals[Math.floor(brwVals.length / 2)]
if (med < 300 || med > 5000) throw new Error(`BRW-Median ${med} €/m² unplausibel`)

const out = {
  standMiete: '2022',
  standBrw: '01.01.2026',
  quelle: 'Angebotsmieten: Wohnatlas Berlin (SenSBW) · Bodenrichtwerte: BORIS Berlin / Gutachterausschuss — beide dl-de-zero-2.0, via Geoportal-WFS',
  plr,
}
writeFileSync(join(root, 'public/data/preise.json'), JSON.stringify(out))
console.log(`✓ preise.json: Miete ${mieteN}/542 PLRs (58 PGR, ${MIETE_LAYER.split(':')[1]}), ` +
  `BRW ${brwN}/542 (aus ${wZones.length} W-Zonen, Median ${med} €/m²)`)
