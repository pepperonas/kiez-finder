// ─────────────────────────────────────────────────────────────────────────
// Konto & Fortschritts-Sync (optional!).
//
// Die App bleibt vollständig offline-fähig: schlägt IRGENDETWAS hier fehl —
// Backend aus, offline, Login abgelehnt — bleibt der Fortschritt einfach lokal
// und nichts geht kaputt. Deshalb gibt jede Funktion im Fehlerfall einen
// harmlosen Wert zurück statt zu werfen.
//
// Der Sync ist ein Union-Merge (hunt.js `mergeProgress`): lokal ∪ Server,
// früherer Erstbesuch gewinnt. Dadurch ist die Reihenfolge egal und mehrere
// Geräte können parallel sammeln, ohne sich gegenseitig zu überschreiben.
// ─────────────────────────────────────────────────────────────────────────

const API = '/api'
const opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } }

/** { authed, name, visits } — bei Fehlern { authed:false, offline:true }. */
export async function fetchMe() {
  try {
    const r = await fetch(`${API}/me`, opts)
    if (!r.ok) return { authed: false, offline: true }
    return await r.json()
  } catch (e) { return { authed: false, offline: true } }
}

/** Fortschritt vom Server — null, wenn nicht angemeldet/erreichbar. */
export async function fetchProgress() {
  try {
    const r = await fetch(`${API}/progress`, opts)
    if (!r.ok) return null
    const d = await r.json()
    return d && d.visited ? d : null
  } catch (e) { return null }
}

/** Fortschritt hochladen; Antwort = server-seitig gemergter Gesamtstand. */
export async function pushProgress(progress) {
  try {
    const r = await fetch(`${API}/progress`, {
      ...opts, method: 'PUT',
      headers: { ...opts.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ visited: progress.visited || {} }),
    })
    if (!r.ok) return null
    const d = await r.json()
    return d && d.visited ? d : null
  } catch (e) { return null }
}

export async function logout() {
  try { await fetch(`${API}/auth/logout`, { ...opts, method: 'POST' }) } catch (e) {}
}

/** Volle Runde: Server holen, mit lokal mergen, zurückschreiben. */
export async function syncProgress(local, merge) {
  const remote = await fetchProgress()
  if (!remote) return null
  const merged = merge(local, remote)
  const saved = await pushProgress(merged)
  return saved || merged // Upload gescheitert? Der Merge gilt trotzdem lokal.
}

export const loginUrl = () => `${API}/auth/google`
/** Google hängt ?login=ok|fehler an — nach dem Auswerten aus der URL putzen. */
export function readLoginFlag(search = location.search) {
  const m = /[?&]login=(ok|fehler)\b/.exec(search)
  return m ? m[1] : null
}
export function stripLoginFlag() {
  try {
    const u = new URL(location.href)
    u.searchParams.delete('login')
    history.replaceState({}, '', u.pathname + (u.search || '') + u.hash)
  } catch (e) {}
}
