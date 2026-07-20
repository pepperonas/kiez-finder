// Eingangsvalidierung für den Fortschritts-Sync. Pure → unit-testbar.
//
// Der Client schickt { visited: { "<qid>": <ts>, … } }. Alles daran ist
// nutzerkontrolliert, also streng prüfen: nur plausible Wikidata-QIDs, nur
// plausible Zeitstempel, harte Obergrenze (die Jagd hat 1000 Orte — mehr kann
// niemand legitim besucht haben; der Puffer deckt spätere POI-Erweiterungen).
export const MAX_VISITS = 4000
export const MAX_QID = 1e9
// Zeitstempel-Fenster: nichts vor der Jagd, nichts nennenswert in der Zukunft
export const MIN_TS = Date.UTC(2026, 0, 1)

/**
 * → { visited: {qid:ts}, dropped } oder null, wenn der Rumpf grundsätzlich
 * unbrauchbar ist. Einzelne kaputte Einträge werden VERWORFEN, nicht der ganze
 * Request abgelehnt — ein alter Client mit einem Schrott-Eintrag soll seinen
 * restlichen Fortschritt trotzdem sichern können.
 */
export function parseProgress(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return null
  const src = body.visited
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null
  const keys = Object.keys(src)
  if (keys.length > MAX_VISITS) return null
  const visited = {}
  let dropped = 0
  const maxTs = now + 864e5 // ein Tag Toleranz für schiefe Client-Uhren
  for (const k of keys) {
    const qid = Number(k)
    const ts = Number(src[k])
    if (!Number.isInteger(qid) || qid <= 0 || qid > MAX_QID) { dropped++; continue }
    if (!Number.isFinite(ts) || ts < MIN_TS || ts > maxTs) { dropped++; continue }
    visited[qid] = Math.round(ts)
  }
  return { visited, dropped }
}

/** Union-Merge wie im Client (hunt.js): früherer Erstbesuch gewinnt. */
export function mergeVisited(a, b) {
  const out = { ...(a || {}) }
  for (const [k, ts] of Object.entries(b || {})) {
    const qid = Number(k)
    out[qid] = out[qid] ? Math.min(out[qid], Number(ts)) : Number(ts)
  }
  return out
}
