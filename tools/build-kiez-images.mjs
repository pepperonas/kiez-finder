#!/usr/bin/env node
// Builds public/data/kiez-img.json + public/img/kiez/<gid>.webp — ein repräsen-
// tatives, offen lizenziertes Foto je umgangssprachlichem Kiez (gid), damit die
// KIEZ-Card (nicht nur POI-Cards) ein Bild zeigt.
//
// Bildquelle, zweistufig:
//   ① Wikipedia-Artikelbild (pageimage) des Kiezes — NUR wenn es ein echtes
//      Foto ist (.jpg/.jpeg; Artikel-„Bilder" sind oft Lagekarten als .png/.svg).
//   ② Wikimedia-Commons-GEOSUCHE um den Kiez-Mittelpunkt (kiez-areas.geojson),
//      gefiltert (keine Karten/Luftbilder/Straßenbrunnen/Stolpersteine/Details)
//      und gerankt: Landmark-Begriffe (Park/Kirche/Platz/Denkmal…) + Kiez-Name
//      im Titel + Größe + Querformat + Nähe. So bekommt Körnerkiez den Körner-
//      park, Weiße Siedlung das Böhmische Dorf, der Rest das prägnanteste Foto
//      aus dem Kiez. Kein Treffer → kein Bild (Card bleibt Text-only).
//
// Dann Download (960px) → WebP (480px q74) → public/img/kiez/<gid>.webp, self-
// hosted wie die POI-Fotos. Urheber+Lizenz je Bild (Commons extmetadata).
// Format: { quelle, info: { "<gid>": { img:1, credit } } }
//
// Reihenfolge: nach build-kiez-info.mjs. Sequenziell + Retry-After (Commons
// 429t Parallelzugriffe). Inkrementell (überspringt vorhandene WebPs).
// Usage: node tools/build-kiez-images.mjs   (~8–12 min)
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/img/kiez')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const WIDTH = 480, QUALITY = 74, PACE_MS = 140
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const kieze = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const areas = JSON.parse(readFileSync(join(root, 'public/data/kiez-areas.geojson'), 'utf8'))
const kiezInfo = JSON.parse(readFileSync(join(root, 'public/data/kiez-info.json'), 'utf8')).info

// je gid: Kiez-Name + Mittelpunkt (aus der zusammengeführten Fläche)
const byGid = new Map()
for (const f of kieze.features) {
  const gid = f.properties.gid
  if (gid == null || byGid.has(gid)) continue
  byGid.set(gid, { gid, name: f.properties.kiez || f.properties.plr_name })
}
function centroid(gid) {
  const a = areas.features.find((x) => x.properties.gid === gid) || kieze.features.find((f) => f.properties.gid === gid)
  const g = a.geometry, rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9
  for (const r of rings) for (const [x, y] of r) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y }
  return [(y1 + y2) / 2, (x1 + x2) / 2]
}
console.log(`  ${byGid.size} umgangssprachliche Kieze (gid)`)

async function apiJson(base, params) {
  for (let a = 0; a < 6; a++) {
    try {
      const res = await fetch(base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: { 'User-Agent': UA } })
      if (res.status === 429) { const ra = parseInt(res.headers.get('retry-after') || '', 10); await sleep(Math.min(Math.max((Number.isFinite(ra) ? ra : 2 * (a + 1)) * 1000, 1500), 30000)); continue }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    } catch (e) { if (a === 5) return null; await sleep(1500 * (a + 1)) }
  }
  return null
}
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const WIKI = 'https://de.wikipedia.org/w/api.php'

const BAD_EXT = /\.(tif|tiff|svg|pdf|xcf|gif|webp)$/i
const BAD_NAME = /stra[sß]enbrunnen|stolperstein|\bDOP\d|orthophoto|luftbild|karte|\bmap\b|\bplan\b|wappen|coat of arms|logo|diagram|schild|gedenktafel|\.stl|baustelle|\bWC\b|first aid|feuerwehr.?einsatz/i
const GOOD = /park|kirche|\bdom\b|kathedrale|platz|schloss|denkmal|brücke|rathaus|museum|kanal|ufer|garten|synagoge|dorf|siedlung|allee|markt|turm|theater|schule|kino|bahnhof/i
const DULL = /playground|spielplatz|\btable\b|tisch|water barrier|detail|mülleimer|papierkorb|hydrant|ampel|verkehrs|parkplatz|garage|toilet|abfall/i

async function resolveImage(k) {
  // Tier 1: Wikipedia-Artikelfoto (nur .jpg/.jpeg)
  const e = kiezInfo[k.name]
  if (e && e.src === 'wp' && e.t) {
    const d = await apiJson(WIKI, { action: 'query', prop: 'pageimages', piprop: 'name', titles: e.t, redirects: '1' })
    await sleep(90)
    const pi = d?.query?.pages?.[0]?.pageimage
    if (pi && /\.(jpe?g)$/i.test(pi)) return 'File:' + pi
  }
  // Tier 2: gerankte Geosuche
  const [lat, lon] = centroid(k.gid)
  const d = await apiJson(COMMONS, { action: 'query', list: 'geosearch', gsnamespace: '6', gsprimary: 'all', gscoord: `${lat}|${lon}`, gsradius: '800', gslimit: '50' })
  await sleep(90)
  const gs = d?.query?.geosearch || []
  const cands = [...new Map(gs.map((g) => [g.title, g])).values()].filter((g) => !BAD_EXT.test(g.title) && !BAD_NAME.test(g.title))
  if (!cands.length) return null
  const ii = await apiJson(COMMONS, { action: 'query', prop: 'imageinfo', iiprop: 'size|mime', titles: cands.slice(0, 40).map((c) => c.title).join('|') })
  await sleep(90)
  const meta = new Map((ii?.query?.pages || []).map((p) => [p.title, p.imageinfo?.[0]]))
  const nn = k.name.toLowerCase().replace(/kiez|viertel|siedlung/g, '').trim()
  const scored = cands.map((c) => {
    const m = meta.get(c.title); if (!m || !/^image\/(jpeg|png)$/.test(m.mime || '')) return null
    const w = m.width || 0, h = m.height || 0; if (w < 640) return null
    let s = Math.min(w, 2200) / 2200 * 40 + (w >= h ? 25 : 0) - c.dist / 25
    if (GOOD.test(c.title)) s += 45; if (DULL.test(c.title)) s -= 40
    if (nn.length > 3 && c.title.toLowerCase().includes(nn)) s += 35
    return { title: c.title, s }
  }).filter(Boolean).sort((a, b) => b.s - a.s)
  return scored[0]?.title || null
}

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
async function creditFor(fileTitle) {
  const d = await apiJson(COMMONS, { action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName', iiurlwidth: '960', titles: fileTitle })
  await sleep(90)
  const im = d?.query?.pages?.[0]?.imageinfo?.[0]
  if (!im) return null
  const artist = stripHtml(im.extmetadata?.Artist?.value).slice(0, 60)
  const lic = stripHtml(im.extmetadata?.LicenseShortName?.value).slice(0, 30)
  return { url: im.thumburl || im.url, credit: [artist, lic].filter(Boolean).join(' · ') || 'Wikimedia Commons' }
}

async function fetchBuf(url) {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 404) return null
      if (res.status === 429) { const ra = parseInt(res.headers.get('retry-after') || '', 10); await sleep(Math.min(Math.max((Number.isFinite(ra) ? ra : 2 * (a + 1)) * 1000, 1500), 30000)); continue }
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const b = Buffer.from(await res.arrayBuffer()); if (b.length < 200 || b[0] === 0x3c) throw new Error('kein Bild')
      return b
    } catch (e) { if (a === 4) return null; await sleep(1500 * (a + 1)) }
  }
  return null
}

// vorhandene Credits erhalten (inkrementelle Re-Runs)
const prev = existsSync(join(root, 'public/data/kiez-img.json'))
  ? JSON.parse(readFileSync(join(root, 'public/data/kiez-img.json'), 'utf8')).info : {}
const out = {}
let ok = 0, skip = 0, miss = 0, n = 0
for (const k of byGid.values()) {
  n++
  const dest = join(OUT, k.gid + '.webp')
  if (existsSync(dest) && statSync(dest).size > 0) { skip++; out[k.gid] = { img: 1, credit: prev[k.gid]?.credit || 'Wikimedia Commons' } }
  else {
    const fileTitle = await resolveImage(k)
    if (!fileTitle) { miss++; out[k.gid] = { img: 0 } }
    else {
      const c = await creditFor(fileTitle)
      const src = c && await fetchBuf(c.url)
      if (!src) { miss++; out[k.gid] = { img: 0 } }
      else {
        const tmp = join(tmpdir(), `kiez-${k.gid}-${process.pid}`)
        try {
          writeFileSync(tmp, src)
          await run('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', '-m', '6', tmp, '-o', dest]).catch(async () => run('magick', [tmp, '-resize', `${WIDTH}x`, '-quality', String(QUALITY), dest]))
          ok++; out[k.gid] = { img: 1, credit: c.credit }
        } catch (e) { miss++; out[k.gid] = { img: 0 }; try { rmSync(dest) } catch {} } finally { try { rmSync(tmp) } catch {} }
      }
    }
    await sleep(PACE_MS)
  }
  if (n % 40 === 0) console.log(`  … ${n}/${byGid.size} (${ok} neu, ${skip} da, ${miss} ohne)`)
}

writeFileSync(join(root, 'public/data/kiez-img.json'), JSON.stringify({ quelle: 'Fotos: Wikipedia / Wikimedia Commons (Urheber+Lizenz je Bild)', info: out }))
let bytes = 0
for (const g of Object.keys(out)) { const p = join(OUT, g + '.webp'); if (existsSync(p)) bytes += statSync(p).size }
const withImg = Object.values(out).filter((e) => e.img === 1).length
console.log(`✓ ${ok} neu, ${skip} vorhanden, ${miss} ohne Bild → ${withImg}/${byGid.size} Kieze mit Foto, ${(bytes / 1048576).toFixed(1)} MB (Ø ${Math.round(bytes / Math.max(1, withImg) / 1024)} KB)`)
