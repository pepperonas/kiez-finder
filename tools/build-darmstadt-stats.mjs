#!/usr/bin/env node
// Baut public/data/darmstadt/stats.json — je Viertel [einwohner, flaeche_m2, alterssumme|null].
// Einwohner: Open Data Darmstadt Bevölkerungsbestand Q4/2025 (ewhg = Hauptwohnsitz),
//   dl-zero-de/2.0, keyed by StatBez → plr_id. Fläche: geodätisch aus den Grenzen.
// Altersstruktur: keine offene Quelle je Bezirk → null.
// Usage: node tools/build-darmstadt-stats.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geodesicAreaM2 } from '../src/stats.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pad4 = (n) => String(n).padStart(4, '0')

// CSV: ags;bezirk;bezirksname;ewhg;…
const csv = readFileSync(join(root, 'tools/vendor/da-bestand-2025-q4.csv'), 'utf8')
const POP = {}
for (const line of csv.trim().split(/\r?\n/).slice(1)) {
  const cols = line.split(';')
  const bez = cols[1]
  if (!/^\d+$/.test(bez)) continue // skip „Gesamt"
  POP[pad4(bez)] = Number(cols[3]) // ewhg
}

const kieze = JSON.parse(readFileSync(join(root, 'public/data/darmstadt/kieze.geojson'), 'utf8'))
const plr = {}
let total = 0
for (const f of kieze.features) {
  const id = f.properties.plr_id
  if (!(id in POP)) throw new Error(`Viertel ohne Einwohnerzahl: ${f.properties.kiez} (${id})`)
  const pop = POP[id]
  const m2 = Math.round(geodesicAreaM2(f.geometry))
  plr[id] = [pop, m2, null]
  total += pop
}
if (Object.keys(plr).length !== 37) throw new Error(`Erwartet 37 Viertel, ${Object.keys(plr).length}`)

const out = {
  stand: '31.12.2025',
  quelle: 'Einwohner: Wissenschaftsstadt Darmstadt, Bevölkerungsbestand Q4/2025 (Hauptwohnsitz, dl-zero-de/2.0). Fläche: geodätisch aus den amtlichen statistischen Bezirksgrenzen (dl-zero-de/2.0).',
  plr,
}
writeFileSync(join(root, 'public/data/darmstadt/stats.json'), JSON.stringify(out))
console.log(`✓ darmstadt/stats.json: 37 Viertel, ${total.toLocaleString('de-DE')} Einwohner`)
const km2 = Object.values(plr).reduce((s, r) => s + r[1], 0) / 1e6
console.log(`  Gesamtfläche (geodätisch): ${km2.toFixed(1)} km²`)
