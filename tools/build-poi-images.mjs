#!/usr/bin/env node
// Lädt die POI-Fotos EINMAL von Wikimedia Commons herunter, skaliert + optimiert
// sie zu WebP und legt sie SELBST-GEHOSTET unter public/img/poi/<qid>.webp ab.
//
// Warum: die Card lud das Foto bisher zur Laufzeit über
// commons.wikimedia.org/Special:FilePath?width= — das 302-redirectet erst auf
// upload.wikimedia.org (Redirect + Fremd-Host + keine Optimierung = langsam,
// kein Offline). Selbst gehostet: gleiche Domain, HTTP/2, Cache-Header, WebP
// (~24 KB statt ~150 KB Original), Service-Worker-cachebar (offline + instant
// beim Wiederbesuch).
//
// Danach trägt poi-info.json `img: 1` (lokales WebP vorhanden) bzw. `0` — der
// Dateiname wird nicht mehr gebraucht (die Card baut die URL aus der qid).
//
// Reihenfolge: nach build-poi-info.mjs. Idempotent/inkrementell: vorhandene
// WebPs werden übersprungen (Re-Runs sind schnell). Braucht `cwebp` (libwebp)
// und Node ≥ 20 (globales fetch).
// Usage: node tools/build-poi-images.mjs   (einmalig, ~5–8 min)
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/img/poi')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
// SEQUENZIELL + Pacing: Wikimedia Commons rate-limitet parallele Zugriffe hart
// (429). Ein Worker mit kurzer Pause + Retry-After-Beachtung ist zuverlässig.
const WIDTH = 480, QUALITY = 74, CONCURRENCY = 1, PACE_MS = 140
mkdirSync(OUT, { recursive: true })

const infoDoc = JSON.parse(readFileSync(join(root, 'public/data/poi-info.json'), 'utf8'))
const jobs = Object.entries(infoDoc.info)
  .filter(([, e]) => e.img && e.img !== 0 && e.img !== 1)
  .map(([qid, e]) => ({ qid: +qid, file: e.img }))
console.log(`  ${jobs.length} POIs mit Commons-Bild`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function fetchBuf(url) {
  for (let a = 0; a < 6; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 404) return null
      if (res.status === 429) { // rate-limited → Retry-After beachten
        const ra = parseInt(res.headers.get('retry-after') || '', 10)
        await sleep(Math.min(Math.max((Number.isFinite(ra) ? ra : 2 * (a + 1)) * 1000, 1500), 30000))
        continue
      }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      // eine durchgerutschte HTML-Fehlerseite ist kein Bild
      if (buf.length < 200 || buf[0] === 0x3c /* '<' */) throw new Error('kein Bild')
      return buf
    } catch (e) { if (a === 5) return null; await sleep(1500 * (a + 1)) }
  }
  return null
}

let ok = 0, skip = 0, miss = 0
async function one(job) {
  const dest = join(OUT, job.qid + '.webp')
  if (existsSync(dest) && statSync(dest).size > 0) { skip++; infoDoc.info[job.qid].img = 1; return }
  // Original in ~960px holen (2× → sauberes Downscaling), dann WebP @480px
  const src = await fetchBuf('https://commons.wikimedia.org/wiki/Special:FilePath/' +
    encodeURIComponent(job.file) + '?width=960')
  if (!src) { miss++; infoDoc.info[job.qid].img = 0; return }
  const tmp = join(tmpdir(), `poi-${job.qid}-${process.pid}`)
  try {
    writeFileSync(tmp, src)
    await run('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', '-m', '6', tmp, '-o', dest])
    ok++
    infoDoc.info[job.qid].img = 1
  } catch (e) {
    // cwebp kann das Format nicht → magick als Fallback (kann alles)
    try {
      await run('magick', [tmp, '-resize', `${WIDTH}x`, '-quality', String(QUALITY), dest])
      ok++; infoDoc.info[job.qid].img = 1
    } catch (e2) { miss++; infoDoc.info[job.qid].img = 0; try { rmSync(dest) } catch {} }
  } finally { try { rmSync(tmp) } catch {} }
}

let i = 0
async function worker() {
  while (i < jobs.length) {
    const j = jobs[i++]
    const before = skip
    await one(j)
    if (skip === before) await sleep(PACE_MS) // nur nach echtem Netzzugriff pausieren, nicht beim Überspringen
    if ((ok + skip + miss) % 100 === 0) console.log(`  … ${ok + skip + miss}/${jobs.length} (${ok} neu, ${skip} da, ${miss} fehlt)`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// POIs, die keinen Commons-Dateinamen hatten, bleiben img:0 (unverändert)
writeFileSync(join(root, 'public/data/poi-info.json'), JSON.stringify(infoDoc))

// Gesamtgröße melden
let bytes = 0, count = 0
for (const e of Object.values(infoDoc.info)) if (e.img === 1) count++
try { for (const f of readdirSync(OUT)) if (f.endsWith('.webp')) bytes += statSync(join(OUT, f)).size } catch {}
console.log(`✓ ${ok} neu geladen, ${skip} vorhanden, ${miss} ohne Bild → ${count} lokale WebPs, ${(bytes / 1048576).toFixed(1)} MB gesamt (Ø ${Math.round(bytes / Math.max(1, count) / 1024)} KB)`)
