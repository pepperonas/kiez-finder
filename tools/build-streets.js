// ─────────────────────────────────────────────────────────────────────────
// Build public/data/strassen.json — every named Berlin street as a compact
// search record: [name, bezirkIdx, centerLon, centerLat, bbox×4].
//
// Input: an Overpass API dump of all named highway ways in Berlin with
// per-way bounds (no geometry needed):
//
//   [out:json][timeout:300];
//   area["ISO3166-2"="DE-BE"][admin_level=4]->.b;
//   way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|road|service)$"][name](area.b);
//   out tags bb;
//
//   curl -sS --data-urlencode data@query.txt \
//     https://overpass-api.de/api/interpreter > streets-raw.json
//
// A street is many way segments; same-named ways whose bounds sit within
// ~300 m of each other are merged into one cluster (union-find), so distant
// same-named streets (e.g. the many Hauptstraßen) stay separate entries.
// Each cluster gets the union bbox, an on-street representative point (the
// member way whose centre is nearest the cluster centre) and its Bezirk via
// our own point-in-polygon against bezirke.geojson.
//
// Usage: node tools/build-streets.js <streets-raw.json>
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs'
import { pointInGeometry, bezirkName } from '../src/kiez.js'

const rawPath = process.argv[2]
if (!rawPath) { console.error('usage: node tools/build-streets.js <streets-raw.json>'); process.exit(1) }

const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
const bezFC = JSON.parse(readFileSync(new URL('../public/data/bezirke.geojson', import.meta.url), 'utf8'))

// merge gap: bounds expanded by this much still touching → same street
const GAP_LAT = 0.0028 // ≈ 310 m
const GAP_LON = 0.0046 // ≈ 310 m at 52.5°N

// name → list of way bounds
const byName = new Map()
for (const el of raw.elements) {
  if (el.type !== 'way' || !el.bounds || !el.tags || !el.tags.name) continue
  const name = el.tags.name.trim()
  if (!name) continue
  const b = el.bounds
  let list = byName.get(name)
  if (!list) byName.set(name, (list = []))
  list.push([b.minlon, b.minlat, b.maxlon, b.maxlat])
}

function touches(a, b) {
  return a[0] - GAP_LON <= b[2] && b[0] - GAP_LON <= a[2] &&
         a[1] - GAP_LAT <= b[3] && b[1] - GAP_LAT <= a[3]
}

// union-find clustering per name group
function clusters(list) {
  const parent = list.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i }
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (touches(list[i], list[j])) { const a = find(i), b = find(j); if (a !== b) parent[b] = a }
  const groups = new Map()
  for (let i = 0; i < list.length; i++) {
    const r = find(i)
    let g = groups.get(r)
    if (!g) groups.set(r, (g = []))
    g.push(list[i])
  }
  return [...groups.values()]
}

// Bezirk lookup (index into the shared name table)
const bezNames = bezFC.features.map((f) => bezirkName(f.properties.bez))
function bezIdxAt(lon, lat) {
  for (let i = 0; i < bezFC.features.length; i++)
    if (pointInGeometry(bezFC.features[i].geometry, lon, lat)) return i
  return -1
}

const r5 = (n) => Math.round(n * 1e5) / 1e5
const streets = []
for (const [name, list] of byName) {
  for (const group of clusters(list)) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const b of group) {
      if (b[0] < x1) x1 = b[0]
      if (b[1] < y1) y1 = b[1]
      if (b[2] > x2) x2 = b[2]
      if (b[3] > y2) y2 = b[3]
    }
    // representative point ON the street: the member way centre nearest the
    // cluster centre (the raw bbox centre of an L-shaped street can be off-road)
    const cx0 = (x1 + x2) / 2, cy0 = (y1 + y2) / 2
    let cx = cx0, cy = cy0, best = Infinity
    for (const b of group) {
      const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2
      const d = (mx - cx0) * (mx - cx0) + (my - cy0) * (my - cy0)
      if (d < best) { best = d; cx = mx; cy = my }
    }
    streets.push([name, bezIdxAt(cx, cy), r5(cx), r5(cy), r5(x1), r5(y1), r5(x2), r5(y2)])
  }
}
streets.sort((a, b) => a[0].localeCompare(b[0], 'de') || a[1] - b[1])

const out = { v: 1, source: 'OpenStreetMap via Overpass (ODbL)', bez: bezNames, streets }
const dest = new URL('../public/data/strassen.json', import.meta.url)
writeFileSync(dest, JSON.stringify(out))
console.log(`ways: ${raw.elements.length}, names: ${byName.size}, clusters: ${streets.length}`)
console.log(`→ public/data/strassen.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
