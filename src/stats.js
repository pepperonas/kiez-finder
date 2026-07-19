// ─────────────────────────────────────────────────────────────────────────
// Statistiken für den ausgewählten Bereich — Einwohner (amtliche Einwohner-
// registerstatistik je LOR-Planungsraum, Stand in stats.json), amtliche
// Fläche, Dichte, Ränge, plus Wikipedia-Kurzbeschreibungen (kiez-info.json).
//
// Kernfunktionen sind PURE (Daten + FeatureCollection werden hineingereicht)
// und damit ohne DOM/Fetch unit-testbar; die dünnen Loader memoisieren.
// Aggregation läuft über die Mitglieds-PLRs (gid-Gruppe bzw. plr_id-Präfix) —
// die LOR-Ebenen sind exakte Partitionen, Summen sind also amtlich korrekt.
// ─────────────────────────────────────────────────────────────────────────

let _stats = null
let _statsP = null
let _info = null
let _infoP = null

export function loadStats() {
  if (!_statsP) {
    _statsP = fetch('/data/stats.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (_stats = d))
      .catch(() => null)
  }
  return _statsP
}
export function loadKiezInfo() {
  if (!_infoP) {
    _infoP = fetch('/data/kiez-info.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (_info = d))
      .catch(() => null)
  }
  return _infoP
}
export const statsData = () => _stats
export const infoData = () => _info

// ── Selektoren: welche PLRs gehören zur gewählten Einheit? ──────────────────
// kiez = gid-Gruppe (jeder PLR trägt gid) · bzr/pgr/bez = plr_id-Präfix (6/4/2)
const PREFIX = { bez: 2, pgr: 4, bzr: 6 }

/** Selektor aus aktivem Level + dem Stand-PLR (Karten-Flow). */
export function selectorFor(level, plrFeature) {
  if (!plrFeature) return null
  const p = plrFeature.properties
  if (level === 'kiez') return p.gid != null ? { kind: 'gid', v: p.gid } : { kind: 'plr', v: p.plr_id }
  if (level === 'plr') return { kind: 'plr', v: p.plr_id }
  if (PREFIX[level]) return { kind: 'prefix', v: p.plr_id.substring(0, PREFIX[level]) }
  return null
}

/** Selektor aus einem Such-Treffer-Feature (bez/bzr/pgr-Aggregat, Kiez-Fläche, PLR). */
export function selectorForFeature(type, feature) {
  if (!feature) return null
  const p = feature.properties
  if (type === 'kiez') return p.gid != null ? { kind: 'gid', v: p.gid } : null
  if (type === 'plr') return { kind: 'plr', v: p.plr_id }
  if (PREFIX[type] && p.id) return { kind: 'prefix', v: p.id }
  return null
}

const matches = (sel, p) =>
  sel.kind === 'gid' ? p.gid === sel.v
    : sel.kind === 'plr' ? p.plr_id === sel.v
      : p.plr_id.startsWith(sel.v)

/**
 * Aggregat über die Mitglieds-PLRs → { pop, m2, n, partial, avgAge, u18, o65 } oder null.
 * pop = null, wenn KEIN Mitglied einen Wert hat (SAFE-anonymisierte PLRs);
 * partial = true, wenn einzelne Mitglieder anonymisiert sind (Summe = Untergrenze).
 * avgAge (approx. aus Altersband-Mitten) + u18/o65 (exakte Bandsummen) sind null,
 * wenn die Daten sie nicht tragen (ältere stats.json) oder pop null ist.
 */
export function aggregate(data, fc, sel) {
  if (!data || !fc || !sel) return null
  let pop = 0, m2 = 0, n = 0, have = 0, partial = false
  let ageSum = 0, u18 = 0, o65 = 0, haveAge = false
  for (const f of fc.features) {
    const p = f.properties
    if (!matches(sel, p)) continue
    const row = data.plr[p.plr_id]
    if (!row) continue
    n++
    m2 += row[1]
    if (row[0] == null) partial = true
    else {
      pop += row[0]; have++
      if (row[2] != null) { ageSum += row[2]; u18 += row[3]; o65 += row[4]; haveAge = true }
    }
  }
  if (!n) return null
  return {
    pop: have ? pop : null, m2, n, partial: partial && have > 0,
    avgAge: haveAge && pop ? ageSum / pop : null,
    u18: haveAge ? u18 : null,
    o65: haveAge ? o65 : null,
  }
}

// ── Ränge: Position der Einheit unter allen Einheiten derselben Ebene ────────
// Einheiten-Schlüssel je Ebene aus den PLR-Features abgeleitet; Ranking nach
// Einwohnern und nach Dichte (Einwohner/km²), anonymisierte Einheiten außen vor.
const keyFns = {
  plr: (p) => p.plr_id,
  kiez: (p) => (p.gid != null ? 'g' + p.gid : p.plr_id),
  bzr: (p) => p.plr_id.substring(0, 6),
  pgr: (p) => p.plr_id.substring(0, 4),
  bez: (p) => p.plr_id.substring(0, 2),
}
const _rankCache = new Map() // level → { byPop: Map(key→rank), byDens: Map, of }

function rankTable(data, fc, level) {
  const hit = _rankCache.get(level)
  if (hit && hit.data === data) return hit
  const keyOf = keyFns[level]
  if (!keyOf) return null
  const agg = new Map() // key → [pop, m2, anyNull]
  for (const f of fc.features) {
    const p = f.properties
    const row = data.plr[p.plr_id]
    if (!row) continue
    const k = keyOf(p)
    let a = agg.get(k)
    if (!a) agg.set(k, (a = [0, 0, false]))
    a[1] += row[1]
    if (row[0] == null) a[2] = true
    else a[0] += row[0]
  }
  const entries = [...agg.entries()].filter(([, a]) => a[0] > 0 || !a[2]) // rein-anonyme raus
  const byPop = new Map(entries.slice().sort((x, y) => y[1][0] - x[1][0]).map(([k], i) => [k, i + 1]))
  const byDens = new Map(entries.slice().sort((x, y) => y[1][0] / y[1][1] - x[1][0] / x[1][1]).map(([k], i) => [k, i + 1]))
  const table = { data, byPop, byDens, of: entries.length }
  _rankCache.set(level, table)
  return table
}

/** { popRank, densRank, of } für die Einheit des Selektors — oder null. */
export function ranksFor(data, fc, level, sel) {
  if (!data || !fc || !sel) return null
  const t = rankTable(data, fc, level)
  if (!t) return null
  const key = sel.kind === 'gid' ? 'g' + sel.v : sel.v
  const popRank = t.byPop.get(key)
  if (!popRank) return null
  return { popRank, densRank: t.byDens.get(key), of: t.of }
}

/** Für Tests / Theme-übergreifende Resets. */
export function clearRankCache() { _rankCache.clear() }

// ── Fläche für Nicht-LOR-Polygone (feine OSM-Kieze): geodätische Näherung ────
// Shoelace je Ring in Metern (Längengrade mit cos(Breite) skaliert) — bei
// Kiez-Ausdehnung (< einige km) weit unter 1 % Abweichung. Ring 0 = Außenring,
// weitere Ringe = Löcher (abgezogen); MultiPolygon = Summe der Teile.
const M_PER_DEG = 111320
export function geodesicAreaM2(geom) {
  if (!geom) return 0
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : []
  let total = 0
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      let s = 0, latSum = 0
      for (const [, y] of ring) latSum += y
      const cos = Math.cos((latSum / ring.length) * Math.PI / 180)
      for (let i = 0; i < ring.length - 1; i++) {
        s += ring[i][0] * cos * ring[i + 1][1] - ring[i + 1][0] * cos * ring[i][1]
      }
      const a = Math.abs(s) / 2 * M_PER_DEG * M_PER_DEG
      total += ri === 0 ? a : -a
    })
  }
  return Math.max(0, total)
}

// ── Kurzbeschreibungen (Wikipedia) ───────────────────────────────────────────
export function infoFor(infoJson, name) {
  return (infoJson && infoJson.info && name && infoJson.info[name]) || null
}
export function infoForBezirk(infoJson, bezName) {
  return infoFor(infoJson, 'bez:' + bezName)
}

// ── Formatierung (de-DE) ─────────────────────────────────────────────────────
export const fmtInt = (n) => n.toLocaleString('de-DE')
export function fmtKm2(m2) {
  const km2 = m2 / 1e6
  const s = km2 < 1 ? km2.toFixed(2) : km2 < 10 ? km2.toFixed(1) : Math.round(km2).toString()
  return s.replace('.', ',') + ' km²'
}
export function fmtDichte(pop, m2) {
  if (pop == null || !m2) return null
  return fmtInt(Math.round(pop / (m2 / 1e6)))
}
/** "42,9 J." — approximatives Durchschnittsalter (aus Altersband-Mitten). */
export function fmtAlter(avgAge) {
  if (avgAge == null) return null
  return avgAge.toFixed(1).replace('.', ',') + ' J.'
}
/** Anteil als "15 %" (kaufmännisch gerundet) — null-sicher. */
export function fmtAnteil(part, total) {
  if (part == null || !total) return null
  return Math.round((part / total) * 100) + ' %'
}
