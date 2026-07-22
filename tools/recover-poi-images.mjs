#!/usr/bin/env node
// Recovery-Pass für POIs OHNE Bild (poi-info img≠1). Der ursprüngliche
// build-poi-images.mjs hing am Wikipedia-Pageimage und verpasste ~40 POIs —
// darunter prominente wie der Fernsehturm. Hier mehrstufig, robuster:
//   ① Wikidata P18 (die qid IST die Wikidata-Q-Nummer → kuratiertes Hauptbild)
//   ② Wikipedia-Artikelfoto (dewiki-Sitelink der Q-Entität, nur .jpg)
//   ③ Commons-Geosuche um die POI-Koordinaten (kategoriegefiltert wie bei den
//      Kiez-Bildern: keine Karten/Wappen/Siegelmarken/Stolpersteine/Pläne)
// Download → WebP (480px q74) → public/img/poi/<qid>.webp, poi-info img:1+credit.
// Sequenziell + Retry-After. Usage: node tools/recover-poi-images.mjs [--all]
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public/img/poi')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Recovery-Skript)'
const WIDTH = 480, QUALITY = 74
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const WIKI = 'https://de.wikipedia.org/w/api.php'
const WIKIDATA = 'https://www.wikidata.org/w/api.php'

const BAD_EXT = /\.(tif|tiff|svg|pdf|xcf|gif|webp)$/i
const BAD_NAME = /stra[sß]enbrunnen|stolperstein|\bDOP\d|orthophoto|luftbild|karte|\bmap\b|\bplan\b|wappen|coat of arms|logo|diagram|schild|gedenktafel|star ?walk|\.stl/i
const BAD_CAT = /\b(maps?|old maps|coats? of arms|emblems|sealing stamps|siegelmarke|stolperstein(e)?|wappen|logos?|diagrams?|floor ?plans?|site ?plans?|aerial (photograph|view)|orthophoto)\b/i

const poiData = JSON.parse(readFileSync(join(root, 'public/data/pois.json'), 'utf8')).pois
const coords = new Map(poiData.map((r) => [String(r[0]), { name: r[1], lon: r[3], lat: r[4] }]))
const piPath = join(root, 'public/data/poi-info.json')
const pi = JSON.parse(readFileSync(piPath, 'utf8'))

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

async function candidateTitles(qid) {
  const c = coords.get(qid) || {}
  // ① Wikidata P18 + dewiki-Sitelink
  const wd = await apiJson(WIKIDATA, { action: 'wbgetentities', ids: 'Q' + qid, props: 'claims|sitelinks' })
  await sleep(70)
  const ent = wd?.entities?.['Q' + qid]
  const out = []
  const p18 = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
  if (p18) out.push('File:' + p18)
  // ② Wikipedia-Artikelfoto (dewiki-Titel → pageimage, nur jpg)
  const t = ent?.sitelinks?.dewiki?.title
  if (t) {
    const d = await apiJson(WIKI, { action: 'query', prop: 'pageimages', piprop: 'name', titles: t, redirects: '1' })
    await sleep(70)
    const pimg = d?.query?.pages?.[0]?.pageimage
    if (pimg && /\.(jpe?g)$/i.test(pimg) && !out.includes('File:' + pimg)) out.push('File:' + pimg)
  }
  // ③ Commons-Geosuche um die Koordinaten
  if (out.length < 2 && c.lat != null) {
    const d = await apiJson(COMMONS, { action: 'query', list: 'geosearch', gsnamespace: '6', gsprimary: 'all', gscoord: `${c.lat}|${c.lon}`, gsradius: '350', gslimit: '30' })
    await sleep(70)
    for (const g of d?.query?.geosearch || []) if (!out.includes(g.title)) out.push(g.title)
  }
  // filtern + Größe/Kategorien prüfen, ranken (P18/Pageimage zuerst, dann Geo)
  const titles = out.filter((x) => !BAD_EXT.test(x) && !BAD_NAME.test(x))
  if (!titles.length) return []
  const meta = new Map()
  for (let i = 0; i < titles.length; i += 40) {
    const d = await apiJson(COMMONS, { action: 'query', prop: 'imageinfo|categories', iiprop: 'size|mime', cllimit: '500', clshow: '!hidden', titles: titles.slice(i, i + 40).join('|') })
    await sleep(80)
    for (const p of d?.query?.pages || []) meta.set(p.title, { ii: p.imageinfo?.[0], cats: (p.categories || []).map((x) => x.title) })
  }
  const ranked = titles.filter((t2, i) => {
    const m = meta.get(t2); if (!m || !m.ii) return false
    if (!/^image\/(jpeg|png)$/.test(m.ii.mime || '')) return false
    if ((m.ii.width || 0) < 500) return false
    const ar = (m.ii.width || 1) / Math.max(1, m.ii.height || 1)
    if (ar > 3.2 || ar < 0.45) return false
    if (m.cats.some((cc) => BAD_CAT.test(cc))) return false
    return true
  })
  return ranked   // Reihenfolge = P18 → Pageimage → Geo (Priorität erhalten)
}

const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
async function creditFor(fileTitle) {
  const d = await apiJson(COMMONS, { action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName', iiurlwidth: '960', titles: fileTitle })
  await sleep(80)
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

const targets = Object.entries(pi.info).filter(([, v]) => v.img !== 1).map(([q]) => q)
console.log(`  ${targets.length} POIs ohne Bild → Recovery`)
let ok = 0, miss = 0, n = 0
for (const qid of targets) {
  n++
  const dest = join(OUT, qid + '.webp')
  const ranked = await candidateTitles(qid)
  let saved = null
  for (const ft of ranked.slice(0, 5)) {
    const c = await creditFor(ft); const src = c && await fetchBuf(c.url)
    if (!src) continue
    const tmp = join(tmpdir(), `poi-${qid}-${process.pid}`)
    try {
      writeFileSync(tmp, src)
      await run('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', '-m', '6', tmp, '-o', dest]).catch(async () => run('magick', [tmp, '-resize', `${WIDTH}x`, '-quality', String(QUALITY), dest]))
      if (existsSync(dest) && statSync(dest).size > 0) { saved = c; break }
    } catch (e) { try { rmSync(dest) } catch {} } finally { try { rmSync(tmp) } catch {} }
  }
  if (saved) { ok++; pi.info[qid].img = 1; pi.info[qid].credit = saved.credit; console.log(`  ✓ ${qid} ${coords.get(qid)?.name} — ${saved.credit}`) }
  else { miss++; console.log(`  · ${qid} ${coords.get(qid)?.name} — kein Bild`) }
  await sleep(140)
}
writeFileSync(piPath, JSON.stringify(pi))
const withImg = Object.values(pi.info).filter((v) => v.img === 1).length
console.log(`\n✓ ${ok} ergänzt, ${miss} weiterhin ohne → ${withImg}/${Object.keys(pi.info).length} POIs mit Bild`)
