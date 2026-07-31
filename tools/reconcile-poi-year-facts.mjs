#!/usr/bin/env node
// Gleicht das Jahr-Eckdatum (Fakt 1: „Eröffnet/Erbaut/Angelegt/Errichtet YYYY",
// aus Wikidata via build-poi-facts) gegen den Wikipedia-Extrakt ab, damit der
// Chip der Prosa DARÜBER nicht widerspricht. Anlass: S-Bahnhof Köllnische Heide
// zeigte „Eröffnet 1993" (Wikidata P1619 = Wiedereröffnung), der Text sagt aber
// „1920 eröffnet" (Wikidata hatte kein P571-Baujahr).
//
// Konservative Regel — greift NUR bei echtem Widerspruch, erfindet nichts und
// STREICHT im Zweifel (behauptet nie ein falsches Jahr):
//   Wenn das Chip-Jahr NIRGENDS im Extrakt vorkommt UND der Extrakt ein anderes
//   Jahr DIREKT an einem Eröffnungs-Verb nennt (eröffnet/erbaut/eingeweiht/…),
//   widerspricht der Chip der Prosa darüber → Jahr-Chip STREICHEN. Fakt 2
//   (Architekt/Höhe/…) bleibt erhalten; das korrekte Jahr steht weiterhin im Text.
//   Bewusst NICHT „auf das Text-Jahr ersetzen": das verb-nahe Jahr im 2-Satz-
//   Extrakt bezieht sich oft auf ein ANDERES Substantiv (Internierungslager
//   Ruhleben: „1908 errichtete *Trabrennbahn*", das Lager war 1914) → Ersetzen
//   würde neue Fehler erzeugen.
//   Kommt das Chip-Jahr im Text vor (korroboriert), bleibt es unangetastet —
//   so bleiben korrekte Chips wie James-Simon-Galerie oder Reichstag 1894.
//
// Idempotent. Nach build-poi-facts UND build-poi-info laufen lassen.
// Usage: node tools/reconcile-poi-year-facts.mjs [--city=frankfurt] [--dry]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileFacts } from './lib/year-reconcile.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cityId = (process.argv.find((a) => a.startsWith('--city=')) || '').split('=')[1] || ''
const sub = cityId ? `${cityId}/` : ''
const dry = process.argv.includes('--dry')

const pois = JSON.parse(readFileSync(join(root, `public/data/${sub}pois.json`), 'utf8'))
const info = JSON.parse(readFileSync(join(root, `public/data/${sub}poi-info.json`), 'utf8')).info

let dropped = 0
const log = []
for (const p of pois.pois) {
  const { facts, dropped: d } = reconcileFacts(p[9], info[String(p[0])]?.x)
  if (!d) continue
  p[9] = facts // bereinigte Liste zurückschreiben
  dropped++
  log.push(`  ✗ ${p[1]}: „${d.fact}" gestrichen (Text nennt ${d.textYears.join('/')} am Verb, Chip ${d.chip} steht nirgends im Text)`)
}

console.log(log.join('\n'))
console.log(`\n${dry ? '[dry] ' : ''}${dropped} widersprüchliche Jahr-Chips gestrichen (von ${pois.pois.length} POIs)`)
if (!dry) writeFileSync(join(root, `public/data/${sub}pois.json`), JSON.stringify(pois))
