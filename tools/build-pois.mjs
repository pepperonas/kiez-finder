#!/usr/bin/env node
// Builds public/data/pois.json — die ~1000 interessantesten Berliner POIs für
// die Schnitzeljagd. Quelle: Wikidata (CC0) via SPARQL.
//
// Auswahl-Logik:
//  · Kandidaten = Objekte IN Berlin (P131*) mit Koordinaten, deren Klasse unter
//    einer der Sehenswürdigkeits-Wurzeln hängt (Bauwerk, Kulturgut, Touristen-
//    attraktion, Park, Museum, Denkmal, archäologische Stätte, Friedhof) —
//    das hält Firmen/Verwaltungseinheiten/Personen draußen.
//  · „Interessantheit" = Zahl der Wikipedia-Sprachversionen (sitelinks). Als
//    Proxy erstaunlich gut: Brandenburger Tor 85, Reichstag 74, Fernsehturm 58.
//  · BEZIRKS-QUOTE: erst die Top-QUOTA je Bezirk, dann global auffüllen. Ohne
//    das lägen ~2/3 aller POIs in Mitte und die Jagd wäre außerhalb des
//    Zentrums leer.
//  · KATEGORIE-DECKEL (13 %): ungedeckelt stellte „Verkehr" 297 von 1000 —
//    207 davon gewöhnliche U-/S-Bahnhöfe, die Museen und Denkmäler verdrängten.
//    Flughafen Tegel/Tempelhof/Hauptbahnhof (viele Sitelinks) bleiben, die
//    Schleppe weicht. Reicht die Auswahl dadurch nicht für TARGET, füllt ein
//    letzter Durchlauf ohne Deckel auf.
//  · Jeder POI bekommt seinen Planungsraum per Point-in-Polygon (eigene
//    Implementierung, wie src/kiez.js) → Fortschritt je Kiez/Bezirk zählbar.
//
// Format (kompakt, ~200 KB):
//   { stand, quelle, kat: [...Kategorienamen], pois: [[qid, name, desc, lon, lat, katIdx, plr_id, sitelinks, artikel|0, facts], ...] }
//   qid = Wikidata-Nummer ohne "Q"; artikel = abweichender de-Wikipedia-Titel oder 0;
//   facts = 0–2 Eckdaten, angehängt von tools/build-poi-facts.mjs (danach ausführen)
//
// Usage: node tools/build-pois.mjs   (ein SPARQL-Request, ~20 s)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = 1000
const QUOTA = 45 // Mindestplätze je Bezirk vor der globalen Auffüllung
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'

const SPARQL = `
SELECT DISTINCT ?item ?itemLabel ?desc ?coord ?sl ?article WHERE {
  ?item wdt:P131* wd:Q64 ; wdt:P625 ?coord ; wikibase:sitelinks ?sl .
  FILTER(?sl >= 2)
  VALUES ?root { wd:Q811979 wd:Q2065736 wd:Q570116 wd:Q22698 wd:Q33506 wd:Q4989906 wd:Q839954 wd:Q39614 }
  ?item wdt:P31/wdt:P279* ?root .
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc)="de") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://de.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}
ORDER BY DESC(?sl) LIMIT 2500`

// ── Kategorien aus der deutschen Wikidata-Beschreibung ableiten ──────────────
// (99 % der Treffer haben eine; die Beschreibungen sind konsistent formuliert,
// z. B. „Museumsgebäude auf der Museumsinsel", „U-Bahnhof in Berlin".)
const KAT = ['Museum', 'Denkmal', 'Kirche', 'Park & Garten', 'Verkehr', 'Brücke', 'Kultur & Bühne',
  'Schloss & Burg', 'Turm & Aussicht', 'Platz & Straße', 'Sport', 'Friedhof', 'Kunst im Raum',
  'Bildung & Wissenschaft', 'Wasser', 'Bauwerk']
const RULES = [
  [/museum|sammlung|galerie|ausstellungshaus/i, 0],
  [/denkmal|gedenk|mahnmal|ehrenmal|erinnerungs|stolperstein/i, 1],
  [/kirche|dom\b|kathedrale|kapelle|synagoge|moschee|kloster|basilika/i, 2],
  [/park|garten|grünanlage|volkspark|tierpark|zoo\b|wald|wiese|forst/i, 3],
  [/bahnhof|u-bahn|s-bahn|haltestelle|flughafen|busbahnhof|hafen\b|bahnstrecke/i, 4],
  [/brücke/i, 5],
  [/theater|oper\b|bühne|kino|konzert|philharmon|varieté|kabarett|club\b|veranstaltungs/i, 6],
  [/schloss|burg\b|palais|palast|herrenhaus|gutshaus/i, 7],
  [/turm|aussichts|fernseh|leuchtturm|windmühle|wasserturm/i, 8],
  [/platz\b|straße|allee|boulevard|promenade|ufer\b|damm\b/i, 9],
  [/stadion|sportplatz|arena|schwimm|bad\b|sporthalle|radrennbahn/i, 10],
  [/friedhof|grabstätte|mausoleum|begräbnis/i, 11],
  [/skulptur|statue|brunnen|plastik|kunstwerk|wandbild|street.?art|installation/i, 12],
  [/universität|hochschule|schule|bibliothek|institut|observatorium|sternwarte|planetarium/i, 13],
  [/see\b|kanal|fluss|teich|spree|havel|wasserfall|schleuse/i, 14],
]
function kategorie(name, desc) {
  const hay = `${desc || ''} ${name || ''}`
  for (const [re, idx] of RULES) if (re.test(hay)) return idx
  return 15 // Bauwerk (Sammelkategorie)
}

// ── Point-in-Polygon (Ray-Cast, wie src/kiez.js) ────────────────────────────
const ringsOf = (g) => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
function inRing([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const inGeom = (pt, g) => { let ins = false; for (const r of ringsOf(g)) if (inRing(pt, r)) ins = !ins; return ins }
function bboxOf(g) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const r of ringsOf(g)) for (const [x, y] of r) {
    if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y
  }
  return [x1, y1, x2, y2]
}

// ── 1) Kandidaten holen ──────────────────────────────────────────────────────
async function fetchSparql() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(SPARQL), {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return (await res.json()).results.bindings
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
}
const rows = await fetchSparql()

const byQid = new Map()
for (const r of rows) {
  const qid = +r.item.value.replace(/.*\/Q/, '')
  if (byQid.has(qid)) continue
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord.value)
  if (!m) continue
  const name = r.itemLabel.value
  if (/^Q\d+$/.test(name)) continue // ohne Label ist ein POI wertlos
  const artTitle = r.article ? decodeURIComponent(r.article.value.split('/wiki/')[1] || '').replace(/_/g, ' ') : null
  byQid.set(qid, {
    qid, name, desc: (r.desc?.value || '').trim(),
    lon: +m[1], lat: +m[2], sl: +r.sl.value,
    art: artTitle && artTitle !== name ? artTitle : 0,
  })
}
console.log(`  ${rows.length} Zeilen → ${byQid.size} eindeutige Kandidaten`)

// ── 2) Planungsraum + Bezirk zuordnen (POIs außerhalb Berlins fallen raus) ──
const kieze = JSON.parse(readFileSync(join(root, 'public/data/kieze.geojson'), 'utf8'))
const plrs = kieze.features.map((f) => ({ id: f.properties.plr_id, bez: f.properties.bez, geom: f.geometry, bb: bboxOf(f.geometry) }))
const candidates = []
for (const p of byQid.values()) {
  const hit = plrs.find((k) => p.lon >= k.bb[0] && p.lon <= k.bb[2] && p.lat >= k.bb[1] && p.lat <= k.bb[3] && inGeom([p.lon, p.lat], k.geom))
  if (!hit) continue // außerhalb der Stadtgrenze (P131* erfasst auch Randfälle)
  candidates.push({ ...p, plr: hit.id, bez: hit.bez, kat: kategorie(p.name, p.desc) })
}
console.log(`  ${candidates.length} davon innerhalb Berlins verortet`)

// ── 3) Auswahl: Bezirks-Quote, dann global nach Sitelinks auffüllen ─────────
candidates.sort((a, b) => b.sl - a.sl || a.qid - b.qid)
const perBez = new Map()
for (const c of candidates) {
  if (!perBez.has(c.bez)) perBez.set(c.bez, [])
  perBez.get(c.bez).push(c)
}
const KAT_CAP = Math.round(TARGET * 0.13)
const picked = new Set()
const katUsed = new Map()
const free = (c) => (katUsed.get(c.kat) || 0) < KAT_CAP
const take = (c) => { picked.add(c); katUsed.set(c.kat, (katUsed.get(c.kat) || 0) + 1) }
// 1. Bezirks-Quote (deckelbewusst) …
for (const [, list] of perBez) {
  let n = 0
  for (const c of list) {
    if (n >= QUOTA) break
    if (!picked.has(c) && free(c)) { take(c); n++ }
  }
}
// 2. … global nach Sitelinks auffüllen …
for (const c of candidates) { if (picked.size >= TARGET) break; if (!picked.has(c) && free(c)) take(c) }
// 3. … notfalls Deckel lösen, damit TARGET erreicht wird
for (const c of candidates) { if (picked.size >= TARGET) break; if (!picked.has(c)) take(c) }
const pois = [...picked].sort((a, b) => b.sl - a.sl || a.qid - b.qid).slice(0, TARGET)

// ── 4) Validierung + schreiben ───────────────────────────────────────────────
const bezCount = new Map()
for (const p of pois) bezCount.set(p.bez, (bezCount.get(p.bez) || 0) + 1)
if (bezCount.size !== 12) throw new Error(`nur ${bezCount.size} Bezirke vertreten`)
const minBez = Math.min(...bezCount.values())
if (minBez < 20) throw new Error(`Bezirk mit nur ${minBez} POIs — Quote greift nicht`)
if (pois.length < TARGET * 0.9) throw new Error(`nur ${pois.length} POIs gefunden`)

const out = {
  stand: new Date().toISOString().slice(0, 10),
  quelle: 'Wikidata (CC0) — Auswahl nach Zahl der Wikipedia-Sprachversionen, Bezirks-Quote; Verortung: LOR 2021',
  kat: KAT,
  pois: pois.map((p) => [p.qid, p.name, p.desc, +p.lon.toFixed(5), +p.lat.toFixed(5), p.kat, p.plr, p.sl, p.art]),
}
writeFileSync(join(root, 'public/data/pois.json'), JSON.stringify(out))

const katCount = new Map()
for (const p of out.pois) katCount.set(KAT[p[5]], (katCount.get(KAT[p[5]]) || 0) + 1)
console.log(`✓ pois.json: ${out.pois.length} POIs, ${bezCount.size} Bezirke (min ${minBez}, max ${Math.max(...bezCount.values())})`)
console.log('  Kategorien:', [...katCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '))
