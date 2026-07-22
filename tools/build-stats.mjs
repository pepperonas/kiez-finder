#!/usr/bin/env node
// Builds public/data/stats.json — Einwohner (amtliche Einwohnerregisterstatistik)
// + amtliche Fläche (m²) je LOR-2021-Planungsraum. Hermetisch: liest die
// vendorten amtlichen Quelldaten aus tools/vendor/ (Provenienz + Verifikation:
// tools/vendor/README.md) und validiert sie strukturell gegen die ausgelieferte
// Geometrie (public/data/kieze.geojson) — jede ID muss exakt matchen.
//
// Format (kompakt, ~22 KB):
//   { stand, quelle, plr: { "<plr_id>": [einwohner|null, flaeche_m2, alterssumme|null] } }
// alterssumme = Σ(Bandmitte × Besetzung) über die feinen Altersbänder — daraus
// rechnet die Runtime das (approximative) Durchschnittsalter aggregierbar
// (Summen addieren, erst am Ende teilen).
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
// feine Altersbänder E_E<von>_<bis> (die U-Summenspalten wie E_E6U15 matchen nicht).
// Bandmitte fürs Durchschnittsalter; das offene Endband 95_110 wird auf 97 gekappt
// (Mitte 102,5 wäre systematisch zu hoch — kaum jemand ist 100+).
const bands = head.map((name, idx) => {
  const m = /^E_E(\d+)_(\d+)$/.exec(name)
  return m ? { idx, lo: +m[1], hi: +m[2], mid: Math.min((+m[1] + +m[2]) / 2, 97) } : null
}).filter(Boolean)
if (bands.length < 20) throw new Error(`EWR-CSV: nur ${bands.length} Altersbänder — Schema geändert?`)
const pop = new Map()
for (const line of csv.slice(1)) {
  const c = line.split(';')
  const id = c[iR].replace(/"/g, '')
  const v = parseInt(c[iE], 10)
  if (Number.isNaN(v)) { pop.set(id, [null, null]); continue } // "NA" = SAFE-anonymisiert
  let ageSum = 0, bandTotal = 0
  for (const b of bands) {
    const n = parseInt(c[b.idx], 10) || 0
    bandTotal += n
    ageSum += n * b.mid
  }
  // Konsistenz: die Bänder müssen exakt zur Gesamtzahl aufsummieren
  if (bandTotal !== v) throw new Error(`EWR-CSV ${id}: Σ Bänder ${bandTotal} ≠ E_E ${v}`)
  pop.set(id, [v, Math.round(ageSum)])
}

// ── amtliche Flächen (finhalt, m²) ───────────────────────────────────────────
const areas = JSON.parse(readFileSync(join(root, 'tools/vendor/lor-flaechen.json'), 'utf8')).flaechen

// ── strukturelle Validierung gegen die ausgelieferte Geometrie ───────────────
const geo = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const ids = geo.features.map((f) => f.properties.plr_id)
if (ids.length !== 542) throw new Error(`Geometrie: ${ids.length} PLRs statt 542`)
const plr = {}
let total = 0, na = 0, ageSumAll = 0
for (const id of ids) {
  if (!pop.has(id)) throw new Error(`EWR-CSV: plr_id ${id} fehlt`)
  if (!(id in areas)) throw new Error(`Flächen: plr_id ${id} fehlt`)
  const [e, ageSum] = pop.get(id)
  plr[id] = [e, areas[id], ageSum]
  if (e == null) na++
  else { total += e; ageSumAll += ageSum }
}
if (total < 3.7e6 || total > 4.1e6) throw new Error(`Berlin-Summe ${total} unplausibel`)
const avgAll = ageSumAll / total
if (avgAll < 40 || avgAll > 46) throw new Error(`Berlin-Ø-Alter ${avgAll.toFixed(1)} unplausibel (amtlich ~42,8)`)

const out = {
  stand: STAND,
  quelle: 'Amt für Statistik Berlin-Brandenburg — Einwohnerregisterstatistik (CC BY); Flächen: Geoportal Berlin (LOR 2021)',
  plr,
}
writeFileSync(join(root, 'public/data/stats.json'), JSON.stringify(out))
console.log(`✓ stats.json: ${ids.length} PLRs, ${total.toLocaleString('de-DE')} Einwohner (Stand ${STAND}), ${na}× NA, ` +
  `${(Object.values(areas).reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} km², Ø-Alter Berlin ≈ ${avgAll.toFixed(1)}`)
