#!/usr/bin/env node
// Builds public/data/poi-info.json — je POI ein Wikipedia-Einleitungstext
// (1–2 Sätze) + optionales Vorschaubild (Wikimedia Commons). Ergänzt die 2
// Kurzfakten aus build-poi-facts.mjs um echten Fließtext + Bild.
//
// Quellen (alle offen): Wikipedia-Extrakt CC BY-SA 4.0 · Commons-Bild je nach
// Datei (Urheber + Lizenz werden mitgeholt und angezeigt).
//
// Pipeline (MediaWiki-API, gebündelt → schnell):
//   1. prop=extracts|pageimages über die Artikel-Titel aller 1000 POIs,
//      20 Titel/Request (exintro, explaintext, 2 Sätze; Thumbnail-Dateiname).
//   2. prop=imageinfo (extmetadata) über die gefundenen File:-Titel → Urheber
//      + Lizenzkürzel für eine korrekte Bildunterschrift.
//
// Format (kompakt, qid-indiziert):
//   { quelle, info: { "<qid>": { x: extrakt, img: "Datei.jpg"|0, credit: "…"|0 } } }
//   img = Commons-Dateiname (ohne "File:"); das Thumbnail baut die App zur
//   Laufzeit über Special:FilePath?width=… (kein gehashter Pfad zu speichern).
//
// Reihenfolge: nach build-pois.mjs (braucht die Artikel-Titel). Idempotent.
// Usage: node tools/build-poi-info.mjs   (~2–3 min)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const API = 'https://de.wikipedia.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiGet(base, params) {
  const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status)
      if (!res.ok) return null
      return res.json()
    } catch (e) {
      if (attempt === 3) { console.log(`  ! ${e.message}`); return null }
      await sleep(1500 * (attempt + 1))
    }
  }
  return null
}

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }

// Extrakt auf max ~2 Sätze / ~300 Zeichen kürzen (exsentences ist grob)
function trimExtract(x) {
  if (!x) return null
  const clean = x.replace(/\s+/g, ' ').trim()
  if (clean.length <= 300) return clean
  const cut = clean.slice(0, 300)
  const dot = cut.lastIndexOf('. ')
  return dot > 140 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …'
}

// ── POIs + Artikel-Titel ─────────────────────────────────────────────────────
const data = JSON.parse(readFileSync(join(root, 'public/data/pois.json'), 'utf8'))
// Titel → Liste der qids (mehrere POIs können denselben Artikel referenzieren)
const titleToQids = new Map()
for (const p of data.pois) {
  const title = (p[8] && p[8] !== 0) ? p[8] : p[1]
  if (!title) continue
  if (!titleToQids.has(title)) titleToQids.set(title, [])
  titleToQids.get(title).push(p[0])
}
const titles = [...titleToQids.keys()]
console.log(`  ${data.pois.length} POIs → ${titles.length} eindeutige Artikel-Titel`)

// ── 1) Extrakte + Thumbnail-Dateinamen ───────────────────────────────────────
const info = {} // qid → { x, img, credit }
const imageTitles = new Set() // "File:…" für den Lizenz-Schritt
const imgByQid = new Map()
let nX = 0, nImg = 0

for (const [bi, batch] of chunk(titles, 20).entries()) {
  const d = await apiGet(API, {
    action: 'query', prop: 'extracts|pageimages',
    exintro: '1', explaintext: '1', exsentences: '2',
    piprop: 'name', redirects: '1', titles: batch.join('|'),
  })
  await sleep(120)
  // redirects zurückverfolgen: normalized/redirects → gefragter Titel
  const alias = new Map()
  for (const r of d?.query?.redirects || []) alias.set(r.to, r.from)
  for (const r of d?.query?.normalized || []) alias.set(r.to, r.from)
  const resolve = (t) => { let cur = t; for (let i = 0; i < 5 && alias.has(cur); i++) cur = alias.get(cur); return cur }
  for (const page of d?.query?.pages || []) {
    if (page.missing) continue
    const asked = resolve(page.title)
    const qids = titleToQids.get(asked) || titleToQids.get(page.title)
    if (!qids) continue
    const x = trimExtract(page.extract)
    const img = page.pageimage || null
    for (const qid of qids) {
      info[qid] = { x: x || 0, img: 0, credit: 0 }
      if (x) nX++
      if (img) { imgByQid.set(qid, img); imageTitles.add('File:' + img) }
    }
  }
  if ((bi + 1) % 10 === 0) console.log(`  … ${(bi + 1) * 20} Titel (${nX} Extrakte, ${imageTitles.size} Bilder)`)
}

// ── 2) Bild-Urheber + Lizenz (Commons extmetadata) ───────────────────────────
const credits = new Map() // "File:…" → "Urheber · Lizenz"
const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
for (const batch of chunk([...imageTitles], 50)) {
  const d = await apiGet(COMMONS, {
    action: 'query', prop: 'imageinfo', iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName', titles: batch.join('|'),
  })
  await sleep(120)
  for (const page of d?.query?.pages || []) {
    const m = page.imageinfo?.[0]?.extmetadata
    if (!m) continue
    const artist = stripHtml(m.Artist?.value).slice(0, 60)
    const lic = stripHtml(m.LicenseShortName?.value).slice(0, 30)
    const credit = [artist, lic].filter(Boolean).join(' · ')
    if (credit) credits.set(page.title, credit)
  }
}
for (const [qid, img] of imgByQid) {
  info[qid].img = img
  const c = credits.get('File:' + img)
  if (c) { info[qid].credit = c; nImg++ }
  else { info[qid].credit = 'Wikimedia Commons'; nImg++ }
}

// ── schreiben ────────────────────────────────────────────────────────────────
writeFileSync(join(root, 'public/data/poi-info.json'), JSON.stringify({
  quelle: 'Texte: Wikipedia (CC BY-SA 4.0) · Bilder: Wikimedia Commons (Urheber/Lizenz je Bild)',
  info,
}))
const kb = Math.round(Buffer.byteLength(JSON.stringify({ info })) / 1024)
console.log(`✓ poi-info.json: ${nX}/${data.pois.length} mit Text, ${nImg} mit Bild (~${kb} KB)`)
