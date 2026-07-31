#!/usr/bin/env node
// Baut die Darmstadt-KERNGRENZEN im App-kompatiblen Format (analog Frankfurt).
// Quelle: Open Data Wissenschaftsstadt Darmstadt, dl-zero-de/2.0 —
//   Statistische Bezirke (37) + Statistische Stadtteile (9), EPSG:25832.
// Hierarchie in der App:
//   Viertel  = statistischer Bezirk (37)  → „Kiez"-Analog
//   Stadtteil = statistischer Stadtteil (9) → „Bezirk"-Analog
//
// ID-Schema: plr_id = pad4(StatBez) z.B. "0110" (Stadtzentrum);
// Bezirk-Präfix = erste 2 Ziffern (= Stadtteil-Nr 01–09). gid = plr_id
// (jedes Viertel = eigene Fläche, kein Merge).
//
// Ausgabe: public/data/darmstadt/{kieze,kiez-areas,bezirke,outline}.geojson
// Usage: node tools/build-darmstadt.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/data/darmstadt')
mkdirSync(OUT, { recursive: true })

const STADTTEIL = {
  1: 'Mitte', 2: 'Nord', 3: 'Ost', 4: 'Bessungen', 5: 'West',
  6: 'Arheilgen', 7: 'Eberstadt', 8: 'Wixhausen', 9: 'Kranichstein',
}
const pad2 = (n) => String(n).padStart(2, '0')
const pad4 = (n) => String(n).padStart(4, '0')

// ── EPSG:25832 (ETRS89 / UTM 32N) → WGS84 ──────────────────────────────────
// Praktisch identisch zu WGS84 für diese Auflösung; Standard-UTM-Rückrechnung.
function utm32ToLonLat(e, n) {
  const a = 6378137.0
  const f = 1 / 298.257222101 // GRS80 (ETRS89)
  const k0 = 0.9996
  const e0 = 500000.0
  const lon0 = 9 * Math.PI / 180 // Zentralmeridian Zone 32
  const ecc = Math.sqrt(2 * f - f * f)
  const ecc2 = ecc * ecc
  const eccp2 = ecc2 / (1 - ecc2)
  const x = e - e0
  const y = n
  const M = y / k0
  const mu = M / (a * (1 - ecc2 / 4 - 3 * ecc2 * ecc2 / 64 - 5 * ecc2 ** 3 / 256))
  const e1 = (1 - Math.sqrt(1 - ecc2)) / (1 + Math.sqrt(1 - ecc2))
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
  const N1 = a / Math.sqrt(1 - ecc2 * Math.sin(phi1) ** 2)
  const T1 = Math.tan(phi1) ** 2
  const C1 = eccp2 * Math.cos(phi1) ** 2
  const R1 = a * (1 - ecc2) / Math.pow(1 - ecc2 * Math.sin(phi1) ** 2, 1.5)
  const D = x / (N1 * k0)
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccp2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccp2 - 3 * C1 * C1) * D ** 6 / 720
  )
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccp2 + 24 * T1 * T1) * D ** 5 / 120
  ) / Math.cos(phi1)
  return [lon * 180 / Math.PI, lat * 180 / Math.PI]
}

function reprojectGeom(geom) {
  const mapRing = (ring) => ring.map(([x, y]) => utm32ToLonLat(x, y))
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(mapRing) }
  }
  if (geom.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geom.coordinates.map((poly) => poly.map(mapRing)) }
  }
  throw new Error(`Unsupported geometry: ${geom.type}`)
}

// ── kieze.geojson (= 37 statistische Bezirke / Viertel) ─────────────────────
const srcBez = JSON.parse(readFileSync(join(root, 'tools/vendor/da-bezirke.geojson'), 'utf8'))
if (srcBez.features.length !== 37) throw new Error(`Erwartet 37 Bezirke, gefunden ${srcBez.features.length}`)

const kieze = {
  type: 'FeatureCollection',
  features: srcBez.features.map((f) => {
    const nr = Number(f.properties.StatBez)
    const name = String(f.properties.stat_Bez_1).trim()
    const stNr = Math.floor(nr / 100)
    if (!STADTTEIL[stNr]) throw new Error(`Unbekannter Stadtteil-Präfix für StatBez ${nr}`)
    const stName = STADTTEIL[stNr]
    const plrId = pad4(nr)
    return {
      type: 'Feature',
      properties: {
        plr_id: plrId,
        gid: plrId,
        kiez: name,
        plr_name: name,
        bez: `${pad2(stNr)} - ${stName}`,
        bzr_name: null,
        pgr_name: null,
        st: pad2(stNr),
      },
      geometry: reprojectGeom(f.geometry),
    }
  }).sort((a, b) => a.properties.plr_id.localeCompare(b.properties.plr_id)),
}
writeFileSync(join(OUT, 'kieze.geojson'), JSON.stringify(kieze))
writeFileSync(join(OUT, 'kiez-areas.geojson'), JSON.stringify(kieze))
console.log(`✓ kieze.geojson + kiez-areas.geojson: ${kieze.features.length} Viertel`)

// ── bezirke.geojson (= 9 statistische Stadtteile) ───────────────────────────
const srcSt = JSON.parse(readFileSync(join(root, 'tools/vendor/da-stadtteile.geojson'), 'utf8'))
if (srcSt.features.length !== 9) throw new Error(`Erwartet 9 Stadtteile, gefunden ${srcSt.features.length}`)

const bez = {
  type: 'FeatureCollection',
  features: srcSt.features.map((f) => {
    const code = Number(f.properties.Stadtteil) // 100…900
    const stNr = Math.floor(code / 100)
    const name = STADTTEIL[stNr]
    if (!name) throw new Error(`Unbekannter Stadtteil-Code ${code}`)
    return {
      type: 'Feature',
      properties: {
        id: pad2(stNr),
        bez: `${pad2(stNr)} - ${name}`,
        bez_name: name,
      },
      geometry: reprojectGeom(f.geometry),
    }
  }).sort((a, b) => a.properties.id.localeCompare(b.properties.id)),
}
writeFileSync(join(OUT, 'bezirke.geojson'), JSON.stringify(bez))
console.log(`✓ bezirke.geojson: ${bez.features.length} Stadtteile`)

// ── outline.geojson — union der Stadtteil-Polygone (bbox-union reicht nicht;
//    wir nehmen die MultiPolygon-Vereinigung als FeatureCollection-Dissolve
//    über alle Ringe → ein Feature). Einfach: alle Stadtteil-Geometrien zu
//    einem MultiPolygon zusammenführen (MapLibre braucht nur die Außengrenze
//    für „outside"-Checks; Löcher/Überlappungen sind unkritisch).
function ringsOf(g) {
  if (g.type === 'Polygon') return [g.coordinates]
  if (g.type === 'MultiPolygon') return g.coordinates
  return []
}
const allPolys = bez.features.flatMap((f) => ringsOf(f.geometry))
const outline = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'Darmstadt' },
    geometry: allPolys.length === 1
      ? { type: 'Polygon', coordinates: allPolys[0] }
      : { type: 'MultiPolygon', coordinates: allPolys },
  }],
}
writeFileSync(join(OUT, 'outline.geojson'), JSON.stringify(outline))
console.log('✓ outline.geojson (Stadtgrenze)')

// Sanity: ein bekannter Punkt (Luisenplatz ≈ 8.6515, 49.8726) muss in Stadtzentrum liegen
const [lx, ly] = [8.6515, 49.8726]
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inGeom(pt, g) {
  let ins = false
  for (const poly of ringsOf(g)) for (const r of poly) if (inRing(pt, r)) ins = !ins
  return ins
}
const hit = kieze.features.find((f) => inGeom([lx, ly], f.geometry))
console.log(`  Sanity Luisenplatz → ${hit ? hit.properties.kiez : 'KEIN TREFFER'}`)
if (!hit || hit.properties.kiez !== 'Stadtzentrum') {
  throw new Error('Reprojektion/Zuordnung fehlerhaft — Luisenplatz nicht in Stadtzentrum')
}

console.log('\nFertig → public/data/darmstadt/')
