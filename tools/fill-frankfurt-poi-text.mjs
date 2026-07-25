#!/usr/bin/env node
// Gezielter Text-Nachtrag: füllt NUR die POIs ohne Extrakt (poi-info x=0/fehlt)
// mit dem dewiki-Einleitungstext — ohne img/credit anzufassen (build-poi-info
// würde alles neu bauen und die per recover-poi-images gesetzten img:1 zerstören).
// Usage: node tools/fill-frankfurt-poi-text.mjs [--city=frankfurt]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Text-Nachtrag, einmalig)'
const API = 'https://de.wikipedia.org/w/api.php'
const sub = ((process.argv.find((a) => a.startsWith('--city=')) || '').split('=')[1] || '') ? 'frankfurt/' : ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiGet(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status)
      if (!res.ok) return null
      return res.json()
    } catch (e) { if (a === 3) return null; await sleep(1500 * (a + 1)) }
  }
  return null
}
function trimExtract(x) {
  if (!x) return null
  const clean = x.replace(/\s+/g, ' ').trim()
  if (clean.length <= 300) return clean
  const cut = clean.slice(0, 300); const dot = cut.lastIndexOf('. ')
  return dot > 140 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …'
}

const pois = JSON.parse(readFileSync(join(root, `public/data/${sub}pois.json`), 'utf8')).pois
const piPath = join(root, `public/data/${sub}poi-info.json`)
const pi = JSON.parse(readFileSync(piPath, 'utf8'))

// POIs ohne Extrakt (x fehlt oder 0)
const missing = pois.filter((p) => !(pi.info[String(p[0])]?.x))
console.log(`  ${missing.length} POIs ohne Text → dewiki-Nachtrag`)

let filled = 0
const still = []
for (const p of missing) {
  const qid = String(p[0])
  const title = (p[8] && p[8] !== 0) ? p[8] : p[1]
  const d = await apiGet({
    action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
    exsentences: '2', redirects: '1', titles: title,
  })
  await sleep(150)
  const page = d?.query?.pages?.[0]
  const x = page && !page.missing ? trimExtract(page.extract) : null
  if (x) {
    if (!pi.info[qid]) pi.info[qid] = { img: 0, credit: 0 }
    pi.info[qid].x = x
    filled++
    console.log(`  ✓ ${qid} ${p[1]} — ${x.slice(0, 60)}…`)
  } else { still.push(p[1]) }
}

writeFileSync(piPath, JSON.stringify(pi))
const withText = pois.filter((p) => pi.info[String(p[0])]?.x).length
console.log(`✓ ${filled} Texte ergänzt · ${withText}/${pois.length} POIs mit Text` +
  (still.length ? ` · ohne (kein dewiki-Artikel): ${still.join(', ')}` : ''))
