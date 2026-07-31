#!/usr/bin/env node
// Baut public/data/darmstadt/kiez-info.json — Kurzbeschreibungen je Viertel
// (+ Stadtteil) aus der deutschen Wikipedia. Schema wie Berlin/Frankfurt.
//
// Artikel-Konvention: „Darmstadt-<Name>", „<Name> (Darmstadt)", teils eigene
// Artikel (Mathildenhöhe, Bessungen …). Schutz: Extract/Titel muss „Darmstadt"
// erwähnen UND der Name muss vorkommen.
//
// Usage: node tools/build-darmstadt-kiez-info.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const kieze = JSON.parse(readFileSync(join(root, 'public/data/darmstadt/kieze.geojson'), 'utf8'))
const bezirke = JSON.parse(readFileSync(join(root, 'public/data/darmstadt/bezirke.geojson'), 'utf8'))

async function getJSON(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    } catch (e) {
      if (attempt === 2) { console.log(`  ! ${url.slice(0, 80)}: ${e.message}`); return null }
      await sleep(1000 * (attempt + 1))
    }
  }
  return null
}
const summary = (title) => getJSON('https://de.wikipedia.org/api/rest_v1/page/summary/' +
  encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true')

function trimExtract(x) {
  if (!x) return null
  const clean = x.replace(/\s+/g, ' ').trim()
  if (clean.length <= 320) return clean
  const cut = clean.slice(0, 320)
  const dot = cut.lastIndexOf('. ')
  return dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …'
}
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[-\s./]+/g, '')

// Basisname eines Split-Viertels (Martinsviertel-West → Martinsviertel)
function baseName(name) {
  const m = name.match(/^(.*?)[-\s](Nord|Süd|Ost|West|N\.|S\.|O\.|W\.)$/i)
  return m ? m[1] : null
}

// Bekannte Alias-/Artikel-Overrides (Name im Datensatz → dewiki-Titel)
const ALIAS = {
  'Mathildenhoehe': 'Mathildenhöhe',
  Mathildenhöhe: 'Mathildenhöhe',
  'An der Ludwigshoehe': 'Ludwigshöhe (Darmstadt)',
  'Am Laemmchesberg': 'Eberstadt',
  'St. Ludwig mit Eichbergviertel': 'Ludwigskirche (Darmstadt)',
  'Rheintor/Grafenstrasse': 'Darmstadt-Mitte',
  Stadtzentrum: 'Darmstadt-Mitte',
  'Alt-Bessungen': 'Bessungen',
  'Alt-Arheilgen': 'Arheilgen',
  'Alt-Eberstadt': 'Eberstadt',
}

async function resolve(name, { relevanceBase = name } = {}) {
  const base = baseName(name)
  const alias = ALIAS[name]
  const cands = [
    ...(alias ? [alias] : []),
    `Darmstadt-${name}`,
    `${name} (Darmstadt)`,
    ...(base ? [`Darmstadt-${base}`, `${base} (Darmstadt)`, base] : []),
    name,
  ]
  const needles = [norm(relevanceBase), ...(base ? [norm(base)] : []), ...(alias ? [norm(alias)] : [])]
    .filter(Boolean)
  const seen = new Set()
  for (const cand of cands) {
    if (seen.has(cand)) continue
    seen.add(cand)
    const s = await summary(cand)
    await sleep(90)
    if (!s || s.type !== 'standard' || !s.extract) continue
    const hay = norm(s.title) + ' ' + norm(s.extract)
    if (!/darmstadt/.test(hay)) continue
    if (!needles.some((nd) => nd && hay.includes(nd))) continue
    return { t: s.title, x: trimExtract(s.extract), u: s.content_urls?.desktop?.page || null, src: 'wp' }
  }
  return null
}

const out = {}
const stat = { wp: 0, miss: 0 }
const misses = []
for (const f of kieze.features) {
  const name = f.properties.kiez
  const hit = await resolve(name)
  if (hit) { out[name] = hit; stat.wp++ } else { stat.miss++; misses.push(name) }
}
console.log(`  Viertel: ${stat.wp}/${kieze.features.length} mit Beschreibung` +
  (misses.length ? ` · ohne: ${misses.join(', ')}` : ''))

let bezN = 0
for (const f of bezirke.features) {
  const bn = f.properties.bez_name
  if (!bn) continue
  const hit = await resolve(bn, { relevanceBase: bn })
  if (hit) { out['bez:' + bn] = hit; bezN++ }
}
console.log(`  Stadtteile: ${bezN}/${bezirke.features.length} mit Beschreibung`)

writeFileSync(join(root, 'public/data/darmstadt/kiez-info.json'), JSON.stringify({
  quelle: 'Wikipedia (CC BY-SA 4.0)',
  info: out,
}))
console.log(`✓ darmstadt/kiez-info.json: ${Object.keys(out).length} Beschreibungen (${stat.wp} Viertel + ${bezN} Stadtteile)`)
