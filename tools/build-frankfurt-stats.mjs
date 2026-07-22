#!/usr/bin/env node
// Baut public/data/frankfurt/stats.json (analog Berlins stats.json) — je
// Stadtteil [einwohner|null, flaeche_m2, alterssumme|null], keyed by plr_id.
// Einwohner: Bürgeramt Statistik & Wahlen Frankfurt, Stand 31.12.2024 (via de.
// Wikipedia „Liste der Stadtteile von Frankfurt am Main"). Fläche: geodätisch aus
// den Stadtteil-Grenzen (self-konsistent). Altersstruktur: noch keine Quelle → null.
// Usage: node tools/build-frankfurt-stats.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geodesicAreaM2 } from '../src/stats.js'
// (Bodenrichtwerte je Stadtteil baut das separate tools/build-frankfurt-heat-prices.mjs)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Einwohner je Stadtteil (Stand 31.12.2024). Flughafen: Bevölkerung wird in
// Sachsenhausen-Süd geführt → hier null (k. A.), rein gewerblich.
const POP = {
  Altstadt: 4288, Innenstadt: 6897, Bahnhofsviertel: 3984, 'Westend-Süd': 20092, 'Westend-Nord': 10268,
  'Nordend-West': 32393, 'Nordend-Ost': 23224, Ostend: 31871, Bornheim: 30919, Gutleutviertel: 6881,
  Gallus: 45609, Bockenheim: 45491, 'Sachsenhausen-Nord': 32941, 'Sachsenhausen-Süd': 30367, Flughafen: null,
  Oberrad: 13855, Niederrad: 31163, Schwanheim: 20720, Griesheim: 32303, Rödelheim: 19899,
  Hausen: 7338, Praunheim: 16700, Heddernheim: 17459, Niederursel: 17746, Ginnheim: 17527,
  Dornbusch: 18732, Eschersheim: 15559, Eckenheim: 14206, Preungesheim: 15770, Bonames: 6365,
  Berkersheim: 3888, Riederwald: 4917, Seckbach: 10471, Fechenheim: 17143, Höchst: 16007,
  Nied: 20127, Sindlingen: 8840, Zeilsheim: 12857, Unterliederbach: 17389, Sossenheim: 16515,
  'Nieder-Erlenbach': 4862, 'Kalbach-Riedberg': 23652, Harheim: 5302, 'Nieder-Eschbach': 12280,
  'Bergen-Enkheim': 18281, 'Frankfurter Berg': 8302,
}

const kieze = JSON.parse(readFileSync(join(root, 'public/data/frankfurt/kieze.geojson'), 'utf8'))
const plr = {}
let total = 0, na = 0
for (const f of kieze.features) {
  const p = f.properties
  const name = p.kiez
  if (!(name in POP)) throw new Error(`Stadtteil ohne Einwohnerzahl: ${name}`)
  const pop = POP[name]
  const m2 = Math.round(geodesicAreaM2(f.geometry))
  plr[p.plr_id] = [pop, m2, null] // alterssumme noch keine Quelle
  if (pop == null) na++
  else total += pop
}
if (Object.keys(plr).length !== 46) throw new Error(`Erwartet 46 Stadtteile, ${Object.keys(plr).length}`)

const out = {
  stand: '31.12.2024',
  quelle: 'Einwohner: Bürgeramt Statistik & Wahlen Frankfurt am Main (31.12.2024). Fläche: geodätisch aus den amtlichen Stadtteilgrenzen (dl-de/by-2.0).',
  plr,
}
writeFileSync(join(root, 'public/data/frankfurt/stats.json'), JSON.stringify(out))
console.log(`✓ stats.json: 46 Stadtteile, ${total.toLocaleString('de-DE')} Einwohner, ${na}× NA (Flughafen)`)
const km2 = Object.values(plr).reduce((s, r) => s + r[1], 0) / 1e6
console.log(`  Gesamtfläche (geodätisch): ${km2.toFixed(1)} km²`)
