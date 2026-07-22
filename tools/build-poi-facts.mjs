#!/usr/bin/env node
// Reichert public/data/pois.json um 1–2 Eckdaten je POI an (Feld [9] = facts).
// Quelle: Wikidata (CC0) via SPARQL — strukturierte Fakten für alle 1000 QIDs
// in EINEM Request (POST, weil 1000 QIDs die GET-URL sprengen).
//
// Geholte Properties: P571 Baujahr · P1619 Eröffnung · P84 Architekt ·
// P2048 Höhe · P149 Baustil · P1435 Denkmalschutz · P1174 Besucher/Jahr.
// Daraus werden bis zu zwei menschenlesbare Kurzfakten komponiert:
//   Fakt 1 = ein Jahr (kategorie-passendes Verb: Erbaut/Eröffnet/Angelegt/…)
//   Fakt 2 = das aussagekräftigste weitere Merkmal (Höhe > Architekt >
//            Besucher > Baustil > Denkmalschutz).
// Fehlt beides, bleibt facts leer — nichts wird erfunden.
//
// Reihenfolge: erst `build-pois.mjs` (erzeugt pois.json), dann DIESES Skript
// (liest pois.json, hängt facts an, schreibt zurück — re-runnable/idempotent).
// Usage: node tools/build-poi-facts.mjs   (~30 s)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sub = ((process.argv.slice(2).find((a) => a.startsWith('--city=')) || '').split('=')[1] || '') ? 'frankfurt/' : ''
const UA = 'kiez-finder/1.0 (https://kiezfinder.celox.io; Build-Skript, einmalig)'

const data = JSON.parse(readFileSync(join(root, `public/data/${sub}pois.json`), 'utf8'))
const KAT = data.kat
const values = data.pois.map((p) => 'wd:Q' + p[0]).join(' ')

// GROUP BY + SAMPLE → genau eine Zeile je POI (mehrwertige Properties egal).
// Labels de mit en-Fallback (manche Architekten/Stile haben nur en).
const SPARQL = `
SELECT ?item
  (SAMPLE(?incy) AS ?inc) (SAMPLE(?opny) AS ?opn)
  (SAMPLE(?archL) AS ?arch) (MAX(?hval) AS ?height)
  (SAMPLE(?styL) AS ?style) (SAMPLE(?her) AS ?heritage) (SAMPLE(?vis) AS ?visitors)
WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P571 ?incd . BIND(YEAR(?incd) AS ?incy) }
  OPTIONAL { ?item wdt:P1619 ?opnd . BIND(YEAR(?opnd) AS ?opny) }
  OPTIONAL { ?item wdt:P84 ?archI .
    OPTIONAL { ?archI rdfs:label ?al FILTER(LANG(?al)="de") }
    OPTIONAL { ?archI rdfs:label ?ale FILTER(LANG(?ale)="en") }
    BIND(COALESCE(?al, ?ale) AS ?archL) }
  OPTIONAL { ?item wdt:P2048 ?hval }
  OPTIONAL { ?item wdt:P149 ?styI .
    OPTIONAL { ?styI rdfs:label ?sl FILTER(LANG(?sl)="de") }
    OPTIONAL { ?styI rdfs:label ?sle FILTER(LANG(?sle)="en") }
    BIND(COALESCE(?sl, ?sle) AS ?styL) }
  OPTIONAL { ?item wdt:P1435 ?herx . BIND(1 AS ?her) }
  OPTIONAL { ?item wdt:P1174 ?vis }
}
GROUP BY ?item`

async function fetchFacts() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
        body: new URLSearchParams({ query: SPARQL }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return (await res.json()).results.bindings
    } catch (e) {
      if (attempt === 2) throw e
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
}

const rows = await fetchFacts()
const byQid = new Map()
for (const r of rows) {
  const qid = +r.item.value.replace(/.*\/Q/, '')
  const num = (k) => (r[k] ? +r[k].value : null)
  byQid.set(qid, {
    inc: num('inc'), opn: num('opn'), height: num('height'),
    arch: r.arch?.value || null, style: r.style?.value || null,
    heritage: !!r.heritage, visitors: num('visitors'),
  })
}

// kategorie-passendes Verb fürs Baujahr
const VERB = (kat) => {
  const k = KAT[kat] || ''
  if (/Park|Garten|Wasser/.test(k)) return 'Angelegt'
  if (/Platz|Straße/.test(k)) return 'Angelegt'
  if (/Denkmal|Kunst/.test(k)) return 'Errichtet'
  if (/Verkehr/.test(k)) return 'Eröffnet'
  return 'Erbaut'
}
const plausibleYear = (y) => Number.isInteger(y) && y >= 1100 && y <= new Date().getFullYear()
const fmtVisitors = (n) => n >= 1e6 ? `${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`
  : n >= 1000 ? `${Math.round(n / 1000)} Tsd.` : String(n)

function factsFor(p) {
  const f = byQid.get(p[0])
  if (!f) return []
  const out = []
  // Fakt 1 — Jahr
  if (plausibleYear(f.inc)) out.push(`${VERB(p[5])} ${f.inc}`)
  else if (plausibleYear(f.opn)) out.push(`Eröffnet ${f.opn}`)
  // Fakt 2 — aussagekräftigstes Merkmal
  if (f.height && f.height >= 5 && f.height < 400) out.push(`${Math.round(f.height)} m hoch`)
  else if (f.arch && f.arch.length <= 40) out.push(`Architekt: ${f.arch}`)
  else if (f.visitors && f.visitors >= 10000) out.push(`~${fmtVisitors(f.visitors)} Besucher/Jahr`)
  else if (f.style && f.style.length <= 34) out.push(f.style)
  else if (f.heritage) out.push('Denkmalgeschützt')
  return out
}

let withAny = 0, withTwo = 0
for (const p of data.pois) {
  const facts = factsFor(p)
  p[9] = facts // Feld [9] anhängen/überschreiben
  if (facts.length) withAny++
  if (facts.length === 2) withTwo++
}
data.factsQuelle = 'Eckdaten: Wikidata (CC0)'
writeFileSync(join(root, `public/data/${sub}pois.json`), JSON.stringify(data))
console.log(`✓ pois.json angereichert: ${withAny}/${data.pois.length} mit ≥1 Eckdatum, ${withTwo} mit zwei`)
