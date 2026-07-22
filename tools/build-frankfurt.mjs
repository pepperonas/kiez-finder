#!/usr/bin/env node
// Baut die Frankfurt-KERNGRENZEN im App-kompatiblen Format (analog Berlins
// kieze/bezirke/outline). Quelle: offizielle Stadtteilgrenzen (Bürgeramt
// Statistik & Wahlen Frankfurt, dl-de/by-2.0, via GeoSchnitz-OpenData-Repo,
// EPSG:4326) + die Stadtteil→Ortsbezirk-Zuordnung (Wikipedia, hier hart als
// Tabelle). Frankfurts Hierarchie ist 3-stufig — die App nutzt davon zwei
// Ebenen: STADTTEIL (= „Kiez"-Analog, 46) und ORTSBEZIRK (= „Bezirk"-Analog, 16).
//
// ID-Schema kompatibel zum Berliner Präfix-System: plr_id = <OB2><ST2> (4-stellig),
// Bezirk(=Ortsbezirk)-Präfix = die ersten 2 Ziffern. gid = plr_id (jeder Stadtteil
// ist eine eigene Fläche, kein Merge).
//
// Ausgabe: public/data/frankfurt/{kieze,kiez-areas,bezirke,outline}.geojson
// Ortsbezirke werden aus den Stadtteilen via `npx mapshaper -dissolve2` gebildet
// (garantiert exakt deckungsgleich). Usage: node tools/build-frankfurt.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/data/frankfurt')
mkdirSync(OUT, { recursive: true })

// Stadtteil → [Ortsbezirk-Nr, Ortsbezirk-Name]
const OB = {
  Altstadt: [1, 'Innenstadt I'], Innenstadt: [1, 'Innenstadt I'], Bahnhofsviertel: [1, 'Innenstadt I'],
  Gutleutviertel: [1, 'Innenstadt I'], Gallus: [1, 'Innenstadt I'],
  'Westend-Süd': [2, 'Innenstadt II'], 'Westend-Nord': [2, 'Innenstadt II'], Bockenheim: [2, 'Innenstadt II'],
  'Nordend-West': [3, 'Innenstadt III'], 'Nordend-Ost': [3, 'Innenstadt III'],
  Ostend: [4, 'Bornheim/Ostend'], Bornheim: [4, 'Bornheim/Ostend'],
  'Sachsenhausen-N.': [5, 'Süd'], 'Sachsenhausen-S.': [5, 'Süd'], Flughafen: [5, 'Süd'], Oberrad: [5, 'Süd'], Niederrad: [5, 'Süd'],
  Schwanheim: [6, 'West'], Griesheim: [6, 'West'], Höchst: [6, 'West'], Nied: [6, 'West'], Sindlingen: [6, 'West'],
  Zeilsheim: [6, 'West'], Unterliederbach: [6, 'West'], Sossenheim: [6, 'West'],
  Rödelheim: [7, 'Mitte-West'], Hausen: [7, 'Mitte-West'], Praunheim: [7, 'Mitte-West'],
  Heddernheim: [8, 'Nord-West'], Niederursel: [8, 'Nord-West'],
  Ginnheim: [9, 'Mitte-Nord'], Dornbusch: [9, 'Mitte-Nord'], Eschersheim: [9, 'Mitte-Nord'],
  Eckenheim: [10, 'Nord-Ost'], Preungesheim: [10, 'Nord-Ost'], Bonames: [10, 'Nord-Ost'], Berkersheim: [10, 'Nord-Ost'], 'Frankfurter Berg': [10, 'Nord-Ost'],
  Riederwald: [11, 'Ost'], Seckbach: [11, 'Ost'], Fechenheim: [11, 'Ost'],
  'Kalbach-Riedberg': [12, 'Kalbach-Riedberg'], 'Nieder-Erlenbach': [13, 'Nieder-Erlenbach'],
  Harheim: [14, 'Harheim'], 'Nieder-Eschbach': [15, 'Nieder-Eschbach'], 'Bergen-Enkheim': [16, 'Bergen-Enkheim'],
}
const pad2 = (n) => String(n).padStart(2, '0')
// Abgekürzte Geodaten-Namen → volle Anzeigenamen
const DISPLAY = { 'Sachsenhausen-N.': 'Sachsenhausen-Nord', 'Sachsenhausen-S.': 'Sachsenhausen-Süd' }

const src = JSON.parse(readFileSync(join(root, 'tools/vendor/ffm-stadtteile.geojson'), 'utf8'))
if (src.features.length !== 46) throw new Error(`Erwartet 46 Stadtteile, gefunden ${src.features.length}`)

// ── kieze.geojson (= Stadtteile im App-Schema) ──
let stCounter = {}
const kieze = { type: 'FeatureCollection', features: src.features.map((f) => {
  const name = f.properties.name.trim()
  if (!OB[name]) throw new Error(`Stadtteil ohne Ortsbezirk-Zuordnung: ${name}`)
  const [obNr, obName] = OB[name]
  const display = DISPLAY[name] || name
  stCounter[obNr] = (stCounter[obNr] || 0) + 1
  const plrId = pad2(obNr) + pad2(stCounter[obNr]) // <OB2><lfd2>
  return {
    type: 'Feature',
    properties: {
      plr_id: plrId, gid: plrId,
      kiez: display, plr_name: display,     // Stadtteil = umgangssprachlicher + amtlicher Name
      bez: `${pad2(obNr)} - ${obName}`,     // Ortsbezirk = „Bezirk"
      bzr_name: null, pgr_name: null,       // Frankfurt hat keine Zwischenebenen
      ob: pad2(obNr),                       // für den Dissolve
    },
    geometry: f.geometry,
  }
}) }
writeFileSync(join(OUT, 'kieze.geojson'), JSON.stringify(kieze))
// kiez-areas = identisch (jeder Stadtteil ist eine eigene Fläche)
writeFileSync(join(OUT, 'kiez-areas.geojson'), JSON.stringify(kieze))
console.log(`✓ kieze.geojson + kiez-areas.geojson: ${kieze.features.length} Stadtteile`)

// ── bezirke.geojson (Ortsbezirke) via mapshaper-Dissolve über `ob` ──
const tmp = join(tmpdir(), 'ffm-kieze.geojson')
writeFileSync(tmp, JSON.stringify(kieze))
const obMeta = {}
for (const [n, [nr, name]] of Object.entries(OB)) obMeta[pad2(nr)] = name
const bezTmp = join(tmpdir(), 'ffm-bezirke.geojson')
execFileSync('npx', ['-y', 'mapshaper', tmp, '-dissolve2', 'ob', 'copy-fields=ob', '-o', 'format=geojson', bezTmp], { stdio: 'inherit' })
const bez = JSON.parse(readFileSync(bezTmp, 'utf8'))
bez.features = bez.features.map((f) => ({
  type: 'Feature',
  properties: { id: f.properties.ob, bez: `${f.properties.ob} - ${obMeta[f.properties.ob]}`, bez_name: obMeta[f.properties.ob] },
  geometry: f.geometry,
})).sort((a, b) => a.properties.id.localeCompare(b.properties.id))
writeFileSync(join(OUT, 'bezirke.geojson'), JSON.stringify(bez))
console.log(`✓ bezirke.geojson: ${bez.features.length} Ortsbezirke`)

// ── outline.geojson (Stadtgrenze) via Dissolve über alles ──
const outTmp = join(tmpdir(), 'ffm-outline.geojson')
execFileSync('npx', ['-y', 'mapshaper', tmp, '-dissolve2', '-o', 'format=geojson', outTmp], { stdio: 'inherit' })
const outline = JSON.parse(readFileSync(outTmp, 'utf8'))
writeFileSync(join(OUT, 'outline.geojson'), JSON.stringify(outline))
console.log(`✓ outline.geojson (Stadtgrenze)`)

console.log('\nFertig → public/data/frankfurt/')
