// ─────────────────────────────────────────────────────────────────────────
// Fuzzy place search across all Berlin LOR levels + colloquial Kieze + every
// named street. Dependency-free, Berlin-tuned: diacritic/ß folding,
// "straße"→"str", and a multi-tier scorer (exact → prefix → word-prefix →
// substring → subsequence → bounded typo). ~2 ms over ~12,500 entries.
// ─────────────────────────────────────────────────────────────────────────
import { bezirkName } from './kiez.js'

const TYPE = {
  bez:  { label: 'Bezirk',        prio: 6 },
  kiez: { label: 'Kiez',          prio: 5 },
  bzr:  { label: 'Bezirksregion', prio: 4 },
  plr:  { label: 'Planungsraum',  prio: 3 },
  pgr:  { label: 'Prognoseraum',  prio: 2 },
  str:  { label: 'Straße',        prio: 1 },
}

// fold to a comparable form: lowercase, strip diacritics, ß→ss, straße→str
export function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/stra(ss|s)?e\b/g, 'str')
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let _index = []

export function buildSearchIndex({ kieze, areas, osmKieze, bez, bzr, pgr, streets }) {
  const out = []
  const seen = new Set() // dedup by norm|type
  const add = (label, type, sub, feature) => {
    if (!label) return
    const n = norm(label)
    const key = n + '|' + type
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label, norm: n, words: n.split(' '), type, typeLabel: TYPE[type].label, prio: TYPE[type].prio, sub, feature })
  }

  // gid → Bezirk name (for Kiez context)
  const gidBez = new Map()
  if (kieze) for (const f of kieze.features) {
    const g = f.properties.gid
    if (g != null && !gidBez.has(g)) gidBez.set(g, bezirkName(f.properties.bez))
  }

  if (bez) for (const f of bez.features) add(bezirkName(f.properties.bez), 'bez', 'Berlin', f)
  // OSM Kiez polygons first → precise named Kieze (e.g. Scheunenviertel) win the
  // norm|type dedup over a same-named Planungsraum-union
  if (osmKieze) for (const f of osmKieze.features) add(f.properties.name, 'kiez', '', f)
  if (areas) for (const f of areas.features) add(f.properties.kiez, 'kiez', gidBez.get(f.properties.gid) || '', f)
  if (bzr) for (const f of bzr.features) add(f.properties.bzr_name, 'bzr', bezirkName(f.properties.bez), f)
  if (pgr) for (const f of pgr.features) {
    const bn = bezirkName(f.properties.bez)
    if (f.properties.pgr_name === bn) continue // redundant with the Bezirk
    add(f.properties.pgr_name, 'pgr', bn, f)
  }
  if (kieze) for (const f of kieze.features) {
    const p = f.properties
    if (p.kiez && p.kiez === p.plr_name) continue // already covered by the Kiez entry
    add(p.plr_name, 'plr', [p.bzr_name, bezirkName(p.bez)].filter(Boolean).join(' · '), f)
  }
  // named streets — no polygon feature, but a representative point + bbox for the
  // camera; same-named streets in different corners of the city stay separate
  // entries (distinguished by their Bezirk sub-line), so no norm|type dedup here
  if (streets) for (const s of streets) {
    const n = norm(s.name)
    if (!n) continue
    out.push({ label: s.name, norm: n, words: n.split(' '), type: 'str', typeLabel: TYPE.str.label, prio: TYPE.str.prio, sub: s.bez || 'Berlin', feature: null, pt: s.pt, bbox: s.bbox })
  }
  _index = out
  return out
}

function isSubseq(q, t) {
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++
  return i === q.length
}

// bounded Levenshtein (early-exit if min row > max)
function editWithin(a, b, max) {
  const al = a.length, bl = b.length
  if (Math.abs(al - bl) > max) return max + 1
  let prev = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    let cur = [i]; let rowMin = i
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[bl]
}

// score one entry against the normalised query; -1 = no match
function scoreEntry(q, e) {
  const n = e.norm
  if (n === q) return 1000
  if (n.startsWith(q)) return 880 - Math.min(60, n.length - q.length)
  // word-boundary prefix
  for (const w of e.words) if (w.startsWith(q)) return 760 - Math.min(40, w.length - q.length)
  const idx = n.indexOf(q)
  if (idx >= 0) return 600 - Math.min(80, idx * 4) - Math.min(40, n.length - q.length)
  if (q.length >= 2 && isSubseq(q, n)) return 360 - Math.min(120, n.length - q.length)
  // typo tolerance on a per-word basis for queries ≥4 chars
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1
    let best = max + 1
    for (const w of e.words) {
      if (Math.abs(w.length - q.length) > max) continue
      const d = editWithin(q, w, max)
      if (d < best) best = d
    }
    if (best <= max) return 240 - best * 70
  }
  return -1
}

export function search(query, limit = 8) {
  const q = norm(query)
  if (!q) return []
  const res = []
  for (const e of _index) {
    const s = scoreEntry(q, e)
    if (s < 0) continue
    res.push({ e, s: s + e.prio * 3 - e.norm.length * 0.1 })
  }
  res.sort((a, b) => b.s - a.s || a.e.label.length - b.e.label.length)
  return res.slice(0, limit).map((r) => r.e)
}
