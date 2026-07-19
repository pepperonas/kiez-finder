#!/usr/bin/env node
// Builds public/data/kiez-info.json — Kurzbeschreibungen („Besonderheiten") je
// Kiez/Bezirk aus der deutschen Wikipedia (REST-Summary-API, CC BY-SA 4.0).
//
// Abgefragt werden: alle umgangssprachlichen Kiez-Namen (kieze.geojson `kiez`),
// die feinen OSM-Kieze (osm-kieze.geojson) und die 12 Bezirke („Bezirk X").
// Schutz gegen Fehlzuordnung:
//   · nur type=standard (keine Begriffsklärungen)
//   · Extract/Description muss „Berlin" erwähnen — sonst verworfen
//   · Kiez-Namen, die in Berlin MEHRFACH vorkommen (verschiedene Flächen mit
//     gleichem Namen), werden übersprungen — ein Artikel könnte die falsche
//     Fläche beschreiben. Lieber Lücke als falscher Text.
// Fallback-Reihenfolge je Name: „<Name>" → „<Name> (Berlin)".
//
// Usage: node tools/build-kiez-info.mjs        (~1–2 min, ~400 Requests, 90 ms Pacing)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Namen einsammeln ─────────────────────────────────────────────────────────
const kieze = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const osm = JSON.parse(readFileSync(join(root, 'public/data/osm-kieze.geojson'), 'utf8'))

// Kiez-Name → Menge der Gruppen (gid), die ihn tragen; >1 = mehrdeutig → skip
const gidsByName = new Map()
for (const f of kieze.features) {
  const { kiez, gid } = f.properties
  if (!kiez) continue
  if (!gidsByName.has(kiez)) gidsByName.set(kiez, new Set())
  gidsByName.get(kiez).add(gid != null ? gid : 'plr:' + f.properties.plr_id)
}
const kiezNames = [...gidsByName.entries()].filter(([, g]) => g.size === 1).map(([n]) => n)
const ambiguous = [...gidsByName.entries()].filter(([, g]) => g.size > 1).map(([n]) => n)
const osmNames = [...new Set(osm.features.map((f) => f.properties.name))].filter((n) => !gidsByName.has(n))
const BEZIRKE = ['Mitte', 'Friedrichshain-Kreuzberg', 'Pankow', 'Charlottenburg-Wilmersdorf', 'Spandau',
  'Steglitz-Zehlendorf', 'Tempelhof-Schöneberg', 'Neukölln', 'Treptow-Köpenick',
  'Marzahn-Hellersdorf', 'Lichtenberg', 'Reinickendorf']

// ── Wikipedia REST Summary ───────────────────────────────────────────────────
async function summary(title) {
  const res = await fetch('https://de.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true', {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) return null
  return res.json()
}

// Extract auf ≤ ~320 Zeichen an Satzgrenze kürzen
function trimExtract(x) {
  if (!x) return null
  const clean = x.replace(/\s+/g, ' ').trim()
  if (clean.length <= 320) return clean
  const cut = clean.slice(0, 320)
  const dot = cut.lastIndexOf('. ')
  return (dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …')
}

async function lookup(name, candidates) {
  for (const title of candidates) {
    const s = await summary(title)
    await sleep(90)
    if (!s || s.type !== 'standard' || !s.extract) continue
    const hay = (s.extract + ' ' + (s.description || ''))
    if (!/[Bb]erlin/.test(hay)) continue // falscher Namensvetter außerhalb Berlins
    return { t: s.title, x: trimExtract(s.extract), u: s.content_urls?.desktop?.page || null }
  }
  return null
}

const out = {}
let hits = 0, misses = 0
for (const name of [...kiezNames, ...osmNames]) {
  const hit = await lookup(name, [name, `${name} (Berlin)`])
  if (hit) { out[name] = hit; hits++ } else misses++
  if ((hits + misses) % 50 === 0) console.log(`  … ${hits + misses} Namen (${hits} Treffer)`)
}
for (const b of BEZIRKE) {
  const hit = await lookup(b, [`Bezirk ${b}`, `Berlin-${b}`])
  if (hit) { out['bez:' + b] = hit; hits++ } else misses++
}

writeFileSync(join(root, 'public/data/kiez-info.json'), JSON.stringify({
  quelle: 'Wikipedia (de.wikipedia.org), Texte CC BY-SA 4.0',
  info: out,
}))
console.log(`✓ kiez-info.json: ${hits} Beschreibungen (${misses} ohne Artikel/verworfen; ` +
  `${ambiguous.length} mehrdeutige Kiez-Namen übersprungen: ${ambiguous.slice(0, 5).join(', ')}${ambiguous.length > 5 ? ' …' : ''})`)
