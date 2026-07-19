#!/usr/bin/env node
// Builds public/data/stats.json — Einwohner (amtliche Einwohnerregisterstatistik)
// + amtliche Fläche (m²) je LOR-2021-Planungsraum. Hermetisch: liest die
// vendorten amtlichen Quelldaten aus tools/vendor/ (Provenienz + Verifikation:
// tools/vendor/README.md) und validiert sie strukturell gegen die ausgelieferte
// Geometrie (public/data/kieze.geojson) — jede ID muss exakt matchen.
//
// Format (kompakt, ~14 KB):
//   { stand, quelle, plr: { "<plr_id>": [einwohner|null, flaeche_m2] } }
// Aggregationen (Kiez-Fläche/BZR/PGR/Bezirk = Summen der Mitglieds-PLRs) macht
// die Runtime (src/stats.js) — die Gruppenzugehörigkeit steckt schon in
// kieze.geojson (gid + plr_id-Präfixe), hier wäre sie Redundanz.
//
// Usage: node tools/build-stats.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAND = '31.12.2025'

// ── Einwohner aus der EWR-Matrix (RAUMID = plr_id, E_E = Einwohner gesamt) ───
const csv = readFileSync(join(root, 'tools/vendor/EWR_L21_202512E_Matrix.csv'), 'utf8').trim().split('\n')
const head = csv[0].split(';').map((s) => s.replace(/"/g, ''))
const iR = head.indexOf('RAUMID')
const iE = head.indexOf('E_E')
if (iR < 0 || iE < 0) throw new Error('EWR-CSV: RAUMID/E_E-Spalte fehlt — Schema geändert?')
const pop = new Map()
for (const line of csv.slice(1)) {
  const c = line.split(';')
  const v = parseInt(c[iE], 10)
  pop.set(c[iR].replace(/"/g, ''), Number.isNaN(v) ? null : v) // "NA" = SAFE-anonymisiert
}

// ── amtliche Flächen (finhalt, m²) ───────────────────────────────────────────
const areas = JSON.parse(readFileSync(join(root, 'tools/vendor/lor-flaechen.json'), 'utf8')).flaechen

// ── strukturelle Validierung gegen die ausgelieferte Geometrie ───────────────
const geo = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const ids = geo.features.map((f) => f.properties.plr_id)
if (ids.length !== 542) throw new Error(`Geometrie: ${ids.length} PLRs statt 542`)
const plr = {}
let total = 0, na = 0
for (const id of ids) {
  if (!pop.has(id)) throw new Error(`EWR-CSV: plr_id ${id} fehlt`)
  if (!(id in areas)) throw new Error(`Flächen: plr_id ${id} fehlt`)
  const e = pop.get(id)
  plr[id] = [e, areas[id]]
  if (e == null) na++
  else total += e
}
if (total < 3.7e6 || total > 4.1e6) throw new Error(`Berlin-Summe ${total} unplausibel`)

const out = {
  stand: STAND,
  quelle: 'Amt für Statistik Berlin-Brandenburg — Einwohnerregisterstatistik (CC BY); Flächen: Geoportal Berlin (LOR 2021)',
  plr,
}
writeFileSync(join(root, 'public/data/stats.json'), JSON.stringify(out))
console.log(`✓ stats.json: ${ids.length} PLRs, ${total.toLocaleString('de-DE')} Einwohner (Stand ${STAND}), ${na}× NA, ` +
  `${(Object.values(areas).reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} km²`)
