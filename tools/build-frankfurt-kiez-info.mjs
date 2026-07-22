#!/usr/bin/env node
// Baut public/data/frankfurt/kiez-info.json — Kurzbeschreibungen je Stadtteil
// (und, best effort, je Ortsbezirk) aus der deutschen Wikipedia. Gleiches
// Schema wie Berlins kiez-info.json ({ quelle, info: { <Name>: {t,x,u,src} } });
// src/stats.js `infoFor`/`infoForBezirk` schlagen darin nach.
//
// Frankfurter Artikel-Konvention auf dewiki: „Frankfurt-<Name>" (Ortsteil-
// Artikel, z.B. Frankfurt-Bornheim, Frankfurt-Höchst). Split-Stadtteile
// (Nord/Süd/West/Ost) teilen sich den Basis-Artikel: Westend-Süd/-Nord →
// „Frankfurt-Westend", Nordend-West/-Ost → „Frankfurt-Nordend",
// Sachsenhausen-Nord/-Süd → „Frankfurt-Sachsenhausen".
//
// Schutz gegen Fehlzuordnung (viele Namen doppeln außerhalb Frankfurts —
// Griesheim, Höchst, Schwanheim …): der Extract/Titel MUSS „Frankfurt"
// erwähnen UND der (Basis-)Name muss im Titel/Extract vorkommen.
//
// Usage: node tools/build-frankfurt-kiez-info.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const kieze = JSON.parse(readFileSync(join(root, 'public/data/frankfurt/kieze.geojson'), 'utf8'))
const bezirke = JSON.parse(readFileSync(join(root, 'public/data/frankfurt/bezirke.geojson'), 'utf8'))

// ── Wikipedia-Helfer ─────────────────────────────────────────────────────────
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
const norm = (s) => (s || '').toLowerCase().replace(/[-\s.]+/g, '')

// Basisname eines Split-Stadtteils (Westend-Süd → Westend, Sachsenhausen-N. → Sachsenhausen)
function baseName(name) {
  const m = name.match(/^(.*?)[-\s](Nord|Süd|Ost|West|N\.|S\.|O\.|W\.)$/)
  return m ? m[1] : null
}

async function resolve(name, { relevanceBase = name } = {}) {
  const base = baseName(name)
  const cands = [
    `Frankfurt-${name}`,
    `${name} (Frankfurt am Main)`,
    ...(base ? [`Frankfurt-${base}`, `${base} (Frankfurt am Main)`] : []),
    name,
  ]
  const needles = [norm(relevanceBase), ...(base ? [norm(base)] : [])]
  const seen = new Set()
  for (const cand of cands) {
    if (seen.has(cand)) continue
    seen.add(cand)
    const s = await summary(cand)
    await sleep(90)
    if (!s || s.type !== 'standard' || !s.extract) continue
    const hay = norm(s.title) + ' ' + norm(s.extract)
    if (!/frankfurt/.test(hay)) continue // muss Frankfurt erwähnen
    if (!needles.some((nd) => hay.includes(nd))) continue // Name(-Basis) muss vorkommen
    return { t: s.title, x: trimExtract(s.extract), u: s.content_urls?.desktop?.page || null, src: 'wp' }
  }
  return null
}

// ── Stadtteile ───────────────────────────────────────────────────────────────
const out = {}
const stat = { wp: 0, miss: 0 }
const misses = []
for (const f of kieze.features) {
  const name = f.properties.kiez
  const hit = await resolve(name)
  if (hit) { out[name] = hit; stat.wp++ } else { stat.miss++; misses.push(name) }
}
console.log(`  Stadtteile: ${stat.wp}/${kieze.features.length} mit Beschreibung` +
  (misses.length ? ` · ohne: ${misses.join(', ')}` : ''))

// ── Ortsbezirke (best effort — viele sind reine Verwaltungsnamen wie „Innenstadt I") ──
let bezN = 0
for (const f of bezirke.features) {
  const bn = f.properties.bez_name
  if (!bn) continue
  const hit = await resolve(bn)
  if (hit) { out['bez:' + bn] = hit; bezN++ }
}
console.log(`  Ortsbezirke: ${bezN}/${bezirke.features.length} mit Beschreibung`)

// ── Audit: kein Artikel darf an mehr als seine Schreibvarianten gehen ────────
const byTitle = new Map()
for (const [k, e] of Object.entries(out)) {
  if (!byTitle.has(e.t)) byTitle.set(e.t, [])
  byTitle.get(e.t).push(k)
}
for (const [t, keys] of byTitle) {
  if (keys.length < 2) continue
  console.log(`  ⚠ geteilter Artikel "${t}" ← ${keys.join(' + ')} (Split-Stadtteile, erwartet)`)
}

writeFileSync(join(root, 'public/data/frankfurt/kiez-info.json'), JSON.stringify({
  quelle: 'Wikipedia (CC BY-SA 4.0)',
  info: out,
}))
console.log(`✓ frankfurt/kiez-info.json: ${Object.keys(out).length} Beschreibungen (${stat.wp} Stadtteile + ${bezN} Ortsbezirke)`)
