// ─────────────────────────────────────────────────────────────────────────
// Schnitzeljagd — die 1000 interessantesten Berliner POIs entdecken.
//
// Spielregel (bewusst streng): ein POI gilt erst als **besucht**, wenn du
// wirklich dort warst — sprich, wenn dein per Geolocation ermittelter Standort
// innerhalb von RADIUS_M um ihn liegt. Antippen auf der Karte merkt ihn nur
// vor („gemerkt"). Sonst wäre es keine Jagd, sondern eine Checkliste.
//
// Kern ist PURE (Daten werden hineingereicht) → unit-testbar ohne DOM/Fetch.
// Fortschritt liegt lokal (localStorage); das Format ist bewusst so schlicht
// (Menge besuchter QIDs + Zeitstempel), dass ein späterer Server-Sync ein
// reiner Union-Merge ist — kein Konflikt möglich.
// ─────────────────────────────────────────────────────────────────────────

export const RADIUS_M = 150 // „du warst da" — großzügig genug für GPS-Drift

let _pois = null
let _poisP = null
export function loadPois() {
  if (!_poisP) {
    _poisP = fetch('/data/pois.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (_pois = d ? { ...d, list: d.pois.map(decodePoi) } : null))
      .catch(() => null)
  }
  return _poisP
}
export const poisData = () => _pois

/** Kompaktes Array-Format → benanntes Objekt. `facts` = 0–2 Eckdaten (Feld [9],
 *  fehlt in älteren pois.json → leer). */
export function decodePoi(a) {
  return { qid: a[0], name: a[1], desc: a[2], lon: a[3], lat: a[4], kat: a[5], plr: a[6], sl: a[7], art: a[8] || null,
    facts: Array.isArray(a[9]) ? a[9] : [] }
}
/** Wikipedia-Link eines POI (Artikel-Titel weicht selten vom Namen ab). */
export const poiUrl = (p) => 'https://de.wikipedia.org/wiki/' + encodeURIComponent((p.art || p.name).replace(/ /g, '_'))

// ── Entfernung ───────────────────────────────────────────────────────────────
/** Haversine-Distanz in Metern. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** POIs im Umkreis (Standard: RADIUS_M), aufsteigend nach Entfernung. */
export function poisNear(list, lat, lon, radius = RADIUS_M) {
  if (!list) return []
  const out = []
  for (const p of list) {
    // grober Vorfilter: 0.01° ≈ 1,1 km — spart die Haversine für 99 % der POIs
    if (Math.abs(p.lat - lat) > 0.02 || Math.abs(p.lon - lon) > 0.03) continue
    const d = distanceM(lat, lon, p.lat, p.lon)
    if (d <= radius) out.push({ poi: p, dist: d })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

/**
 * Die n nächstgelegenen POIs (ohne Radiusgrenze), je mit Entfernung.
 * Wird gebraucht, weil 162 der 427 Kieze gar keinen POI enthalten — dort zeigt
 * die Card „die nächsten in der Umgebung" statt einer leeren Jagd-Sektion.
 */
export function nearestPois(list, lat, lon, n = 5) {
  if (!list || !list.length) return []
  return list
    .map((poi) => ({ poi, dist: distanceM(lat, lon, poi.lat, poi.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
}

/** "480 m" / "2,3 km" — kompakte Entfernungsangabe. */
export function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return ''
  if (m < 1000) return Math.round(m / 10) * 10 + ' m'
  return (m / 1000).toFixed(1).replace('.', ',') + ' km'
}

// ── Fortschritt ──────────────────────────────────────────────────────────────
/** Leerer Fortschritt. `v` erlaubt spätere Formatmigration, `visited`: qid → Zeitstempel (ms). */
export const emptyProgress = () => ({ v: 1, visited: {} })

/** Aus localStorage lesen — defekt/leer → leerer Fortschritt (nie Throw). */
export function readProgress(storage, key = 'kf-hunt') {
  try {
    const raw = storage.getItem(key)
    if (!raw) return emptyProgress()
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || typeof p.visited !== 'object' || !p.visited) return emptyProgress()
    const visited = {}
    for (const [k, t] of Object.entries(p.visited)) {
      const qid = +k, ts = +t
      if (Number.isFinite(qid) && Number.isFinite(ts)) visited[qid] = ts
    }
    return { v: 1, visited }
  } catch (e) { return emptyProgress() }
}
export function writeProgress(storage, progress, key = 'kf-hunt') {
  try { storage.setItem(key, JSON.stringify(progress)) } catch (e) {}
  return progress
}

/** Besuch eintragen (idempotent: der ERSTE Besuch zählt, spätere ändern nichts). */
export function markVisited(progress, qid, ts = Date.now()) {
  if (progress.visited[qid]) return { changed: false, progress }
  return { changed: true, progress: { ...progress, visited: { ...progress.visited, [qid]: ts } } }
}

/** Besuch zurücknehmen (Fehleingabe rückgängig). Immutable; idempotent, wenn
 *  der POI gar nicht als besucht galt. Gibt den vorigen Zeitstempel zurück,
 *  damit ein „Rückgängig" den ursprünglichen Besuch exakt wiederherstellen kann. */
export function unmarkVisited(progress, qid) {
  if (!progress.visited[qid]) return { changed: false, progress, prevTs: null }
  const prevTs = progress.visited[qid]
  const visited = { ...progress.visited }
  delete visited[qid]
  return { changed: true, progress: { ...progress, visited }, prevTs }
}

/**
 * Union-Merge zweier Fortschritte (lokal ↔ Server): jeder je besuchte POI
 * bleibt besucht, bei Dopplung gewinnt der FRÜHERE Zeitstempel (der echte
 * Erstbesuch). Kommutativ + idempotent → beliebig oft anwendbar.
 */
export function mergeProgress(a, b) {
  const visited = { ...(a?.visited || {}) }
  for (const [k, ts] of Object.entries(b?.visited || {})) {
    const qid = +k
    visited[qid] = visited[qid] ? Math.min(visited[qid], +ts) : +ts
  }
  return { v: 1, visited }
}

// ── Auswertung ───────────────────────────────────────────────────────────────
const isVisited = (progress, qid) => !!(progress && progress.visited[qid])
export { isVisited }

/** Gesamtstand: { total, visited, pct }. */
export function overallProgress(list, progress) {
  const total = list ? list.length : 0
  let visited = 0
  for (const p of list || []) if (isVisited(progress, p.qid)) visited++
  return { total, visited, pct: total ? Math.round((visited / total) * 100) : 0 }
}

/**
 * Fortschritt für eine Auswahl (Kiez/Bezirksregion/Bezirk): alle POIs, deren
 * Planungsraum zur Auswahl gehört. `plrIds` = Set der zugehörigen plr_ids.
 */
export function scopeProgress(list, progress, plrIds) {
  const pois = (list || []).filter((p) => plrIds.has(p.plr))
  let visited = 0
  for (const p of pois) if (isVisited(progress, p.qid)) visited++
  return { total: pois.length, visited, pois, done: pois.length > 0 && visited === pois.length }
}

/** Ränge/Abzeichen: wie viele Kieze sind komplett? (gid → plr_ids) */
export function completedAreas(list, progress, plrsByArea) {
  let done = 0, withPois = 0
  for (const [, plrIds] of plrsByArea) {
    const s = scopeProgress(list, progress, plrIds)
    if (s.total === 0) continue
    withPois++
    if (s.done) done++
  }
  return { done, withPois }
}

/** Spielstand-Titel — kleine Motivationsstufen statt nackter Prozentzahl. */
export const RANKS = [
  { at: 0, title: 'Neu in der Stadt' },
  { at: 5, title: 'Tourist' },
  { at: 25, title: 'Zugezogen' },
  { at: 75, title: 'Kiezgänger' },
  { at: 150, title: 'Stadtbekannt' },
  { at: 300, title: 'Urgestein' },
  { at: 600, title: 'Berlin-Legende' },
]
export function rankFor(visitedCount) {
  let cur = RANKS[0], next = null
  for (const r of RANKS) {
    if (visitedCount >= r.at) cur = r
    else { next = r; break }
  }
  return { title: cur.title, next, toNext: next ? next.at - visitedCount : 0 }
}
