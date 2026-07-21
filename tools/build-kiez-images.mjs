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
// Ablehnung per Commons-KATEGORIE — der entscheidende Filter: der Dateiname
// verrät die Kartennatur oft NICHT (z. B. „…Luisenstadt…jpg" ist eine Karte),
// die Kategorien aber schon („Maps of…", „Coats of arms…", „Sealing stamps…",
// „Stolpersteine in…"). Fängt Karten/Pläne/Wappen/Siegelmarken/Stolpersteine/
// Luftbilder/Logos/Diagramme — verschont echte Orts-Fotos.
const BAD_CAT = /\b(maps?|old maps|coats? of arms|emblems|sealing stamps|siegelmarke|stolperstein(e)?|wappen|logos?|diagrams?|floor ?plans?|site ?plans?|aerial (photograph|view)|orthophoto|panoramas?)\b/i
const GOOD = /park|kirche|\bdom\b|kathedrale|platz|schloss|denkmal|brücke|rathaus|museum|kanal|ufer|garten|synagoge|dorf|siedlung|allee|markt|turm|theater|schule|kino|bahnhof/i
const DULL = /playground|spielplatz|\btable\b|tisch|water barrier|detail|mülleimer|papierkorb|hydrant|ampel|verkehrs|parkplatz|garage|toilet|abfall/i

// Kandidaten-Pool aus drei Quellen (dedupliziert): kuratiertes WP-Artikelfoto,
// die Commons-Kategorie DES KIEZES (kuratierte Orts-Fotos) und die Geosuche um
// den Mittelpunkt (800→1500 m). Jede Quelle trägt eine „dist" fürs Ranking.
async function candidatePool(k) {
  const pool = new Map()
  const add = (title, source, dist) => { if (title && !pool.has(title)) pool.set(title, { source, dist }) }
  // ① Wikipedia-Artikelfoto
  const e = kiezInfo[k.name]
  if (e && e.src === 'wp' && e.t) {
    const d = await apiJson(WIKI, { action: 'query', prop: 'pageimages', piprop: 'name', titles: e.t, redirects: '1' })
    await sleep(80)
    const pi = d?.query?.pages?.[0]?.pageimage
    if (pi) add('File:' + pi, 'wp', 0)
  }
  // ② Commons-Kategorie(n) des Kiezes
  for (const cat of [`Category:${k.name}`, `Category:${k.name}, Berlin`]) {
    const d = await apiJson(COMMONS, { action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: 'file', cmlimit: '40' })
    await sleep(80)
    for (const m of d?.query?.categorymembers || []) add(m.title, 'cat', 60)
  }
  // ③ Geosuche um den Mittelpunkt (zweite, weitere Runde nur bei dünnem Pool)
  const [lat, lon] = centroid(k.gid)
  for (const rad of ['800', '1500']) {
    if (pool.size >= 14) break
    const d = await apiJson(COMMONS, { action: 'query', list: 'geosearch', gsnamespace: '6', gsprimary: 'all', gscoord: `${lat}|${lon}`, gsradius: rad, gslimit: '50' })
    await sleep(80)
    for (const g of d?.query?.geosearch || []) add(g.title, 'geo', g.dist)
  }
  return pool
}

// → gerankte LISTE geeigneter Dateititel (nicht nur der Top-Treffer), damit die
// Hauptschleife bei einem Download-Fehler weiter unten weitermachen kann.
async function resolveImage(k) {
  const pool = await candidatePool(k)
  const titles = [...pool.keys()].filter((t) => !BAD_EXT.test(t) && !BAD_NAME.test(t))
  if (!titles.length) return []
  // Größe + MIME + Kategorien in einem gebatchten Query (chunks von 40)
  const meta = new Map()
  for (let i = 0; i < titles.length; i += 40) {
    const d = await apiJson(COMMONS, { action: 'query', prop: 'imageinfo|categories', iiprop: 'size|mime', cllimit: '500', clshow: '!hidden', titles: titles.slice(i, i + 40).join('|') })
    await sleep(90)
    for (const p of d?.query?.pages || []) meta.set(p.title, { ii: p.imageinfo?.[0], cats: (p.categories || []).map((c) => c.title) })
  }
  const nn = k.name.toLowerCase().replace(/kiez|viertel|siedlung/g, '').trim()
  const scored = titles.map((t) => {
    const m = meta.get(t); if (!m || !m.ii) return null
    const w = m.ii.width || 0, h = m.ii.height || 0
    if (!/^image\/(jpeg|png)$/.test(m.ii.mime || '')) return null
    if (w < 640) return null
    const ar = w / Math.max(1, h)
    if (ar > 3 || ar < 0.5) return null                       // Panorama / Hochkant-Dokument
    if (m.cats.some((c) => BAD_CAT.test(c))) return null       // ← Karte/Wappen/Siegelmarke/Stolperstein
    const info = pool.get(t)
    let s = Math.min(w, 2200) / 2200 * 40 + (w >= h ? 25 : 0) - info.dist / 25
    if (info.source === 'wp') s += 55                          // kuratiertes Artikelfoto
    if (info.source === 'cat') s += 30                          // kuratierte Orts-Kategorie
    if (GOOD.test(t)) s += 45; if (DULL.test(t)) s -= 40
    if (nn.length > 3 && t.toLowerCase().includes(nn)) s += 35
    return { title: t, s }
  }).filter(Boolean).sort((a, b) => b.s - a.s)
  return scored.map((x) => x.title)
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

// Lädt fileTitle → WebP nach dest; gibt {credit,file} zurück oder null bei Fehler.
async function downloadWebp(fileTitle, dest) {
  const c = await creditFor(fileTitle)
  const src = c && await fetchBuf(c.url)
  if (!src) return null
  const tmp = join(tmpdir(), `kiez-${process.pid}-${Math.abs(hash(fileTitle))}`)
  try {
    writeFileSync(tmp, src)
    await run('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', '-m', '6', tmp, '-o', dest])
      .catch(async () => run('magick', [tmp, '-resize', `${WIDTH}x`, '-quality', String(QUALITY), dest]))
    if (!existsSync(dest) || statSync(dest).size === 0) throw new Error('leeres WebP')
    return { credit: c.credit, file: fileTitle }
  } catch (e) { try { rmSync(dest) } catch {} return null } finally { try { rmSync(tmp) } catch {} }
}
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

// KF_FORCE=1 → alles neu auflösen+laden (purged auch früher durchgerutschte
// Karten); KF_GIDS=k12,k39 → nur diese neu; sonst inkrementell (vorhandene
// WebPs behalten, Credit/file aus dem letzten Lauf übernehmen).
const FORCE = process.env.KF_FORCE === '1'
const GIDS = new Set((process.env.KF_GIDS || '').split(',').map((s) => s.trim()).filter(Boolean))
const prev = existsSync(join(root, 'public/data/kiez-img.json'))
  ? JSON.parse(readFileSync(join(root, 'public/data/kiez-img.json'), 'utf8')).info : {}
const out = {}
let ok = 0, skip = 0, miss = 0, n = 0
for (const k of byGid.values()) {
  n++
  const dest = join(OUT, k.gid + '.webp')
  const redo = FORCE || GIDS.has(k.gid)
  if (!redo && existsSync(dest) && statSync(dest).size > 0) {
    skip++; out[k.gid] = { img: 1, credit: prev[k.gid]?.credit || 'Wikimedia Commons', ...(prev[k.gid]?.file ? { file: prev[k.gid].file } : {}) }
  } else {
    const ranked = await resolveImage(k)   // gerankte Liste
    let saved = null
    for (const ft of ranked.slice(0, 6)) { saved = await downloadWebp(ft, dest); if (saved) break }  // Walk-Down
    if (saved) { ok++; out[k.gid] = { img: 1, credit: saved.credit, file: saved.file } }
    else { miss++; out[k.gid] = { img: 0 }; try { if (existsSync(dest)) rmSync(dest) } catch {} }
    await sleep(PACE_MS)
  }
  if (n % 40 === 0) console.log(`  … ${n}/${byGid.size} (${ok} neu, ${skip} da, ${miss} ohne)`)
}

writeFileSync(join(root, 'public/data/kiez-img.json'), JSON.stringify({ quelle: 'Fotos: Wikipedia / Wikimedia Commons (Urheber+Lizenz je Bild)', info: out }))
let bytes = 0
for (const g of Object.keys(out)) { const p = join(OUT, g + '.webp'); if (existsSync(p)) bytes += statSync(p).size }
const withImg = Object.values(out).filter((e) => e.img === 1).length
console.log(`✓ ${ok} neu, ${skip} vorhanden, ${miss} ohne Bild → ${withImg}/${byGid.size} Kieze mit Foto, ${(bytes / 1048576).toFixed(1)} MB (Ø ${Math.round(bytes / Math.max(1, withImg) / 1024)} KB)`)
