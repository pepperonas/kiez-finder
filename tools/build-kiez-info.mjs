#!/usr/bin/env node
// Builds public/data/kiez-info.json — Kurzbeschreibungen („Besonderheiten")
// je Kiez/Bezirk aus MEHREREN Quellen, gestuft nach Belastbarkeit:
//
//   ① OSM-Tag `wikipedia` ("de:Berlin-Wedding") → Wikipedia-Extrakt.
//      AUTORITATIV: die Zuordnung Ort→Artikel kommt aus OSM, nicht aus meinem
//      Namensraten — findet Artikel, die Tier ③ verfehlt, und kann nicht
//      auf ein fremdes Redirect-Ziel driften.
//   ② OSM-Tag `wikidata` (QID) → dewiki-Sitelink → Wikipedia-Extrakt. Ebenso
//      autoritativ, nur über Wikidata statt direkt.
//   ③ Namensbasierte Wikipedia-Suche mit Relevanz-Regel (s. u.) — der alte
//      Weg, für Kieze ohne OSM-Verknüpfung.
//   ④ Wikidata-Kurzbeschreibung (CC0) — kurz, aber echt („Ortsteil von Berlin").
//   ⑤ OSM-Tag `description`.
//   Kein Treffer → KEIN Eintrag; die App erzeugt dann aus den amtlichen Zahlen
//   eine Faktenzeile (src/stats.js `kiezFallbackText`), sodass wirklich jeder
//   Bereich Kontext zeigt, ohne dass irgendein Text erfunden wird.
//
// Jeder Eintrag trägt `src` (wp|wd|osm) → die Card weist die richtige Lizenz
// aus (Wikipedia CC BY-SA, Wikidata CC0, OSM ODbL).
//
// Schutz gegen Fehlzuordnung (Tier ③):
//   · nur type=standard (keine Begriffsklärungen)
//   · Extract/Description muss „Berlin" erwähnen
//   · NAMENS-RELEVANZ: der Kiez-Name (oder sein kiez↔viertel-Synonym) muss im
//     TITEL oder Extract vorkommen. Fängt Redirect-Drift: Donaukiez/
//     Flughafenkiez/Harzer Kiez sind Redirects auf „Berlin-Neukölln" und
//     zeigten sonst identische Ortsteil-Texte.
//   · in Berlin mehrdeutige Kiez-Namen werden übersprungen.
//
// Usage: node tools/build-kiez-info.mjs [--refresh-osm]
//   Der Overpass-Abzug wird in tools/vendor/osm-places.json gecacht (Rebuilds
//   ohne Netz-Roundtrip); --refresh-osm erzwingt einen neuen Abzug.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Namen einsammeln ─────────────────────────────────────────────────────────
const kieze = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const osmKieze = JSON.parse(readFileSync(join(root, 'public/data/osm-kieze.geojson'), 'utf8'))

const gidsByName = new Map()
for (const f of kieze.features) {
  const { kiez, gid } = f.properties
  if (!kiez) continue
  if (!gidsByName.has(kiez)) gidsByName.set(kiez, new Set())
  gidsByName.get(kiez).add(gid != null ? gid : 'plr:' + f.properties.plr_id)
}
const kiezNames = [...gidsByName.entries()].filter(([, g]) => g.size === 1).map(([n]) => n)
const ambiguous = [...gidsByName.entries()].filter(([, g]) => g.size > 1).map(([n]) => n)
const osmNames = [...new Set(osmKieze.features.map((f) => f.properties.name))].filter((n) => !gidsByName.has(n))
const BEZIRKE = ['Mitte', 'Friedrichshain-Kreuzberg', 'Pankow', 'Charlottenburg-Wilmersdorf', 'Spandau',
  'Steglitz-Zehlendorf', 'Tempelhof-Schöneberg', 'Neukölln', 'Treptow-Köpenick',
  'Marzahn-Hellersdorf', 'Lichtenberg', 'Reinickendorf']

// ── OSM-Places (Overpass, gecacht) ───────────────────────────────────────────
const OSM_CACHE = join(root, 'tools/vendor/osm-places.json')
const OVERPASS = `[out:json][timeout:180];
area["name"="Berlin"]["admin_level"="4"]->.b;
(
  node(area.b)["place"~"^(quarter|neighbourhood|suburb|borough)$"];
  way(area.b)["place"~"^(quarter|neighbourhood|suburb|borough)$"];
  relation(area.b)["place"~"^(quarter|neighbourhood|suburb|borough)$"];
);
out tags center;`

async function loadOsmPlaces() {
  if (existsSync(OSM_CACHE) && !process.argv.includes('--refresh-osm')) {
    return JSON.parse(readFileSync(OSM_CACHE, 'utf8'))
  }
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'User-Agent': UA },
    body: new URLSearchParams({ data: OVERPASS }),
  })
  if (!res.ok) throw new Error('Overpass HTTP ' + res.status)
  const d = await res.json()
  const slim = d.elements.filter((e) => e.tags?.name).map((e) => ({
    name: e.tags.name, wikidata: e.tags.wikidata || null,
    wikipedia: e.tags.wikipedia || null, description: e.tags.description || null,
  })).filter((e) => e.wikidata || e.wikipedia || e.description)
  writeFileSync(OSM_CACHE, JSON.stringify({ stand: new Date().toISOString().slice(0, 10), places: slim }))
  return { places: slim }
}
const osmPlaces = (await loadOsmPlaces()).places
const osmByName = new Map()
for (const p of osmPlaces) if (!osmByName.has(p.name)) osmByName.set(p.name, p)
console.log(`  OSM-Places mit Verknüpfung: ${osmPlaces.length} (${[...osmByName.values()].filter((p) => p.wikidata).length} mit QID)`)

// ── Wikipedia / Wikidata ─────────────────────────────────────────────────────
async function getJSON(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (res.status === 404) return null // echter Miss
      if (!res.ok) throw new Error('HTTP ' + res.status) // 429/5xx = transient → Retry
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

// Wikidata: QID → { dewiki-Titel, de-Beschreibung } (Batches à 50)
async function wikidataBatch(qids) {
  const out = new Map()
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50)
    const d = await getJSON('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json' +
      `&ids=${batch.join('|')}&props=sitelinks|descriptions&sitefilter=dewiki&languages=de`)
    await sleep(150)
    for (const [qid, ent] of Object.entries(d?.entities || {})) {
      out.set(qid, {
        dewiki: ent.sitelinks?.dewiki?.title || null,
        desc: ent.descriptions?.de?.value || null,
      })
    }
  }
  return out
}
const allQids = [...new Set([...osmByName.values()].map((p) => p.wikidata).filter(Boolean))]
const wdInfo = await wikidataBatch(allQids)
console.log(`  Wikidata aufgelöst: ${wdInfo.size} QIDs (${[...wdInfo.values()].filter((v) => v.dewiki).length} mit de-Artikel)`)

// ── Relevanz-Regel für Tier ③ ────────────────────────────────────────────────
const normName = (s) => (s || '').toLowerCase().replace(/[-\s]+/g, '')
function nameVariants(name) {
  const n = normName(name)
  const v = new Set([n])
  if (n.endsWith('kiez')) v.add(n.slice(0, -4) + 'viertel')
  if (n.endsWith('viertel')) v.add(n.slice(0, -7) + 'kiez')
  return [...v]
}
function trimExtract(x) {
  if (!x) return null
  const clean = x.replace(/\s+/g, ' ').trim()
  if (clean.length <= 320) return clean
  const cut = clean.slice(0, 320)
  const dot = cut.lastIndexOf('. ')
  return dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …'
}
const wpEntry = (s) => ({ t: s.title, x: trimExtract(s.extract), u: s.content_urls?.desktop?.page || null, src: 'wp' })

async function fromWikipedia(title, { checkName = null } = {}) {
  const s = await summary(title)
  await sleep(90)
  if (!s || s.type !== 'standard' || !s.extract) return null
  if (!/[Bb]erlin/.test(s.extract + ' ' + (s.description || ''))) return null
  if (checkName) {
    const nt = normName(s.title), nx = normName(s.extract)
    if (!nameVariants(checkName).some((v) => nt.includes(v) || nx.includes(v))) return null
  }
  return wpEntry(s)
}

// ── Auflösung je Name ────────────────────────────────────────────────────────
async function resolve(name, extraCandidates = []) {
  const osm = osmByName.get(name)
  // ① OSM-wikipedia-Tag (autoritativ, keine Relevanzprüfung nötig)
  if (osm?.wikipedia) {
    const [lang, title] = osm.wikipedia.split(':')
    if (lang === 'de' && title) {
      const hit = await fromWikipedia(title)
      if (hit) return hit
    }
  }
  // ② OSM-wikidata → dewiki
  const wd = osm?.wikidata ? wdInfo.get(osm.wikidata) : null
  if (wd?.dewiki) {
    const hit = await fromWikipedia(wd.dewiki)
    if (hit) return hit
  }
  // ③ Namensraten mit Relevanz-Regel
  for (const cand of [name, `${name} (Berlin)`, `Berlin-${name}`, ...extraCandidates]) {
    const hit = await fromWikipedia(cand, { checkName: name })
    if (hit) return hit
  }
  // ④ Wikidata-Kurzbeschreibung
  if (wd?.desc) return { t: name, x: wd.desc, u: `https://www.wikidata.org/wiki/${osm.wikidata}`, src: 'wd' }
  // ⑤ OSM-description
  if (osm?.description) return { t: name, x: osm.description, u: null, src: 'osm' }
  return null
}

const out = {}
let n = 0
const stat = { wp: 0, wd: 0, osm: 0, miss: 0 }
for (const name of [...kiezNames, ...osmNames]) {
  const hit = await resolve(name)
  if (hit) { out[name] = hit; stat[hit.src]++ } else stat.miss++
  if (++n % 50 === 0) console.log(`  … ${n} Namen (${stat.wp} WP · ${stat.wd} WD · ${stat.osm} OSM)`)
}
for (const b of BEZIRKE) {
  const hit = await resolve(b, [`Bezirk ${b}`])
  if (hit) { out['bez:' + b] = hit; stat[hit.src]++ } else stat.miss++
}

// ── Audit: geteilte Artikel dürfen nur Schreibvarianten desselben Orts sein ──
const byTitle = new Map()
for (const [name, e] of Object.entries(out)) {
  if (e.src !== 'wp') continue
  if (!byTitle.has(e.t)) byTitle.set(e.t, [])
  byTitle.get(e.t).push(name)
}
for (const [t, names] of byTitle) {
  if (names.length < 2) continue
  const variants = names.every((nm) => normName(t).includes(normName(nm)) || names.every((o) => normName(o) === normName(nm)))
  console.log(`  ⚠ geteilter Artikel "${t}" ← ${names.join(' + ')}${variants ? ' (Schreibvarianten, ok)' : ' — PRÜFEN!'}`)
}

writeFileSync(join(root, 'public/data/kiez-info.json'), JSON.stringify({
  quelle: 'Wikipedia (CC BY-SA 4.0) · Wikidata (CC0) · OpenStreetMap (ODbL)',
  info: out,
}))
console.log(`✓ kiez-info.json: ${Object.keys(out).length} Beschreibungen — ` +
  `${stat.wp} Wikipedia · ${stat.wd} Wikidata · ${stat.osm} OSM · ${stat.miss} ohne Quelle (App zeigt Datenzeile); ` +
  `${ambiguous.length} mehrdeutige Namen übersprungen`)
