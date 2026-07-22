#!/usr/bin/env node
// Baut public/data/frankfurt/preise.json — Bodenrichtwerte je Stadtteil für die
// Heatmap. Quelle: BORIS Hessen / Gutachterausschuss (dl-de/by-2.0), zonale
// Bodenrichtwerte Frankfurt am Main, Stichtag 01.01.2024, via Geodaten-WFS.
//
//  · brw: mittlerer Bodenrichtwert €/m² für WOHNBAULAND (art ∈ {W,WA,WR}) je
//    Stadtteil. Über ein Innenpunkt-Raster gemittelt (bbox-vorgefiltertes
//    Point-in-Polygon in die BRW-Zonen) — konvergiert gegen das flächen-
//    gewichtete Mittel der W-Zonen; Stadtteile ohne Wohnbauland-Treffer
//    (Flughafen/Gewerbe/Grün) → null.
//  · miete: keine offene, flächendeckende Frankfurter Quelle je Stadtteil
//    (Berlins Wohnatlas ist berlin-spezifisch) → durchweg null.
//
// Der WFS liefert nur GML (kein GeoJSON) → schlanker Regex-Parser hier.
// Format: { standMiete:null, standBrw, quelle, plr: { "<plr_id>": [null, brw|null] } }
// Usage: node tools/build-frankfurt-heat-prices.mjs   (holt den WFS live, ~24 MB GML)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (+https://kiezfinder.celox.io build-frankfurt-heat-prices)'
const BASE = 'https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs'
// Frankfurt am Main gesamt (WGS84 lat/lon-Bbox, großzügig)
const BBOX = '50.01,8.46,50.24,8.81,urn:ogc:def:crs:EPSG::4326'
const WFS = BASE +
  '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
  '&TYPENAMES=boris:BR_BodenrichtwertZonal' +
  '&SRSNAME=urn:ogc:def:crs:EPSG::4326' +
  `&BBOX=${encodeURIComponent(BBOX)}`

// ── Geometrie-Helfer (Ray-Cast, wie src/kiez.js / build-heat-prices.mjs) ─────
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const ringsOf = (g) => g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
const inGeom = (pt, g) => { // even-odd über alle Ringe (Löcher zählen raus)
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

// ── GML-Parser: zonale BRW-Features → { art, brw, geom } ─────────────────────
// posList-Achsenreihenfolge ist lat lon (urn:ogc:def:crs:EPSG::4326) → [lon,lat].
function parseRing(posList) {
  const n = posList.trim().split(/\s+/).map(Number)
  const ring = []
  for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i + 1], n[i]]) // swap → [lon,lat]
  return ring
}
function parseZones(xml) {
  const members = xml.split(/<wfs:member>|<gml:featureMember>/).slice(1)
  const zones = []
  for (const m of members) {
    const art = /<boris:art>([^<]*)<\/boris:art>/.exec(m)?.[1]
    const brw = /<boris:bodenrichtwert>([^<]*)<\/boris:bodenrichtwert>/.exec(m)?.[1]
    if (!art || brw == null) continue
    if (!(art === 'W' || art === 'WA' || art === 'WR')) continue // Wohnbauland
    const val = parseFloat(brw)
    if (!Number.isFinite(val) || val <= 0) continue
    const rings = [...m.matchAll(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/g)].map((x) => parseRing(x[1]))
    if (!rings.length) continue // 1. Ring = exterior, weitere = Löcher
    const geom = { type: 'Polygon', coordinates: rings }
    zones.push({ brw: val, geom, bb: bboxOf(geom) })
  }
  return zones
}

// ── 1) BRW-Zonen (Wohnbauland) vom WFS holen ─────────────────────────────────
console.log('· Lade BORIS-Hessen-WFS (Frankfurt, ~24 MB GML) …')
const res = await fetch(WFS, { headers: { 'User-Agent': UA, Accept: 'text/xml' } })
if (!res.ok) throw new Error(`WFS → ${res.status}`)
const xml = await res.text()
const matched = /numberReturned="(\d+)"/.exec(xml)?.[1]
const wZones = parseZones(xml)
if (wZones.length < 800) throw new Error(`Nur ${wZones.length} W-Zonen (von ${matched}) — Filter/Quelle prüfen`)

// ── 2) je Stadtteil über Innenpunkt-Raster mitteln ───────────────────────────
const kieze = JSON.parse(readFileSync(join(root, 'public/data/frankfurt/kieze.geojson'), 'utf8'))
if (kieze.features.length !== 46) throw new Error('frankfurt/kieze.geojson ≠ 46 Stadtteile')

function brwFor(plrGeom) {
  const [x1, y1, x2, y2] = bboxOf(plrGeom)
  const N = 10 // 10×10-Innenpunkt-Raster je Stadtteil (feiner als Berlins 8 — Stadtteile sind größer als PLRs)
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

const plr = {}
let brwN = 0
for (const f of kieze.features) {
  const brw = brwFor(f.geometry)
  plr[f.properties.plr_id] = [null, brw] // [miete, brw] — Miete durchweg null
  if (brw != null) brwN++
}
if (brwN < 30) throw new Error(`BRW-Abdeckung nur ${brwN}/46 Stadtteile`)
const brwVals = Object.values(plr).map((r) => r[1]).filter((v) => v != null).sort((a, b) => a - b)
const med = brwVals[Math.floor(brwVals.length / 2)]
if (med < 300 || med > 6000) throw new Error(`BRW-Median ${med} €/m² unplausibel`)

const out = {
  standMiete: null,
  standBrw: '01.01.2024',
  quelle: 'Bodenrichtwerte: BORIS Hessen / Gutachterausschuss für Immobilienwerte Frankfurt am Main (Stichtag 01.01.2024), dl-de/by-2.0, via Geodaten-WFS gds.hessen.de. Wohnbauland (art W/WA/WR).',
  plr,
}
writeFileSync(join(root, 'public/data/frankfurt/preise.json'), JSON.stringify(out))
console.log(`✓ frankfurt/preise.json: BRW ${brwN}/46 Stadtteile (aus ${wZones.length} W-Zonen, ` +
  `Median ${med} €/m², Spanne ${brwVals[0]}–${brwVals[brwVals.length - 1]})`)
