// ─────────────────────────────────────────────────────────────────────────
// kiezfinder-api — der EINZIGE Serverteil dieser sonst rein statischen App.
// Er macht genau eine Sache: den Schnitzeljagd-Fortschritt an ein Google-Konto
// binden, damit er geräteübergreifend erhalten bleibt.
//
// Grundsätze:
//  · Die App funktioniert ohne diesen Dienst vollständig weiter (Fortschritt
//    dann lokal). Jeder Endpunkt darf ausfallen, ohne die PWA zu beschädigen.
//  · Datensparsam: gespeichert werden Google-`sub` (stabile ID), Anzeigename
//    und besuchte POI-IDs. KEINE E-Mail, keine Google-Tokens, kein Tracking.
//  · Der Merge ist ein Union über (sub, qid) mit dem FRÜHEREN Zeitstempel —
//    kommutativ und idempotent, also konfliktfrei bei parallelen Geräten.
//
// Betrieb: systemd `kiezfinder-api`, Port 4251 (nur loopback), nginx proxyt
// /api/ von kiezfinder.celox.io. Secrets in /opt/kiezfinder-api/.env (640).
// ─────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { sign, verify, newSession, parseCookies, cookieHeader, clearCookie, randomState, COOKIE, STATE_COOKIE, SESSION_DAYS } from './lib/session.js'
import { parseProgress, mergeVisited } from './lib/validate.js'

const root = dirname(fileURLToPath(import.meta.url))

// ── Konfiguration (.env, ohne Dependency) ────────────────────────────────────
const env = { ...process.env }
const envFile = join(root, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const PORT = +(env.PORT || 4251)
const ORIGIN = env.ORIGIN || 'https://kiezfinder.celox.io'
const CLIENT_ID = env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET
const APP_SECRET = env.APP_SECRET
const DATA_DIR = env.DATA_DIR || join(root, 'data')
const REDIRECT_URI = `${ORIGIN}/api/auth/google/callback`
const SECURE = ORIGIN.startsWith('https')
for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, APP_SECRET })) {
  if (!v) { console.error(`FATAL: ${k} fehlt in .env`); process.exit(1) }
}

// ── Datenbank ────────────────────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true })
const db = new Database(join(DATA_DIR, 'kiezfinder.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    sub TEXT PRIMARY KEY, name TEXT, created INTEGER NOT NULL, seen INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS visits (
    sub TEXT NOT NULL, qid INTEGER NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (sub, qid)) WITHOUT ROWID;
`)
const q = {
  upsertUser: db.prepare(`INSERT INTO users (sub,name,created,seen) VALUES (?,?,?,?)
    ON CONFLICT(sub) DO UPDATE SET name=excluded.name, seen=excluded.seen`),
  getVisits: db.prepare('SELECT qid, ts FROM visits WHERE sub = ?'),
  // Union-Merge: der FRÜHERE Erstbesuch gewinnt
  putVisit: db.prepare(`INSERT INTO visits (sub,qid,ts) VALUES (?,?,?)
    ON CONFLICT(sub,qid) DO UPDATE SET ts = MIN(ts, excluded.ts)`),
  countVisits: db.prepare('SELECT COUNT(*) n FROM visits WHERE sub = ?'),
}
const putVisits = db.transaction((sub, visited) => {
  for (const [qid, ts] of Object.entries(visited)) q.putVisit.run(sub, Number(qid), ts)
})

// ── Mini-Rate-Limit (pro IP, gleitendes Fenster) ─────────────────────────────
const hits = new Map()
function rateLimited(ip, limit = 120, windowMs = 60000) {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now - rec.start > windowMs) { hits.set(ip, { start: now, n: 1 }); return false }
  rec.n++
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k)
  return rec.n > limit
}

// ── Helfer ───────────────────────────────────────────────────────────────────
const send = (res, code, obj, headers = {}) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}
const redirect = (res, location, headers = {}) => { res.writeHead(302, { Location: location, ...headers }); res.end() }
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0
    const chunks = []
    req.on('data', (c) => {
      n += c.length
      if (n > limit) { reject(new Error('too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'
  if (rateLimited(ip)) return send(res, 429, { error: 'rate_limited' })
  const url = new URL(req.url, ORIGIN)
  const path = url.pathname
  const cookies = parseCookies(req.headers.cookie)
  const session = verify(cookies[COOKIE], APP_SECRET)

  try {
    // ── Login: Weiterleitung zu Google (state gegen CSRF) ──────────────────
    if (path === '/api/auth/google' && req.method === 'GET') {
      const state = randomState()
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.searchParams.set('client_id', CLIENT_ID)
      auth.searchParams.set('redirect_uri', REDIRECT_URI)
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('scope', 'openid profile') // KEIN email-Scope: nicht nötig
      auth.searchParams.set('state', state)
      auth.searchParams.set('prompt', 'select_account')
      return redirect(res, auth.href, {
        'Set-Cookie': cookieHeader(STATE_COOKIE, state, { maxAge: 600, secure: SECURE }),
      })
    }

    // ── Rückkehr von Google: Code eintauschen, Session setzen ──────────────
    if (path === '/api/auth/google/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const clear = clearCookie(STATE_COOKIE, { secure: SECURE })
      if (!code || !state || state !== cookies[STATE_COOKIE]) {
        return redirect(res, '/?login=fehler', { 'Set-Cookie': clear })
      }
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) {
        console.error('token exchange failed', tokenRes.status, (await tokenRes.text()).slice(0, 300))
        return redirect(res, '/?login=fehler', { 'Set-Cookie': clear })
      }
      const tok = await tokenRes.json()
      // Das id_token stammt aus einem direkten, TLS-gesicherten Austausch mit
      // Google unter Vorlage unseres Client-Secrets → die Nutzlast ist damit
      // vertrauenswürdig; eine separate Signaturprüfung wäre redundant.
      const payloadB64 = String(tok.id_token || '').split('.')[1]
      if (!payloadB64) return redirect(res, '/?login=fehler', { 'Set-Cookie': clear })
      let claims
      try { claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) } catch (e) { claims = null }
      if (!claims || !claims.sub || claims.aud !== CLIENT_ID) {
        return redirect(res, '/?login=fehler', { 'Set-Cookie': clear })
      }
      const now = Date.now()
      q.upsertUser.run(claims.sub, (claims.given_name || claims.name || '').slice(0, 60), now, now)
      const sess = sign(newSession(claims.sub, claims.given_name || claims.name || '', now), APP_SECRET)
      return redirect(res, '/?login=ok', {
        'Set-Cookie': [clear, cookieHeader(COOKIE, sess, { maxAge: SESSION_DAYS * 86400, secure: SECURE })],
      })
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(COOKIE, { secure: SECURE }) })
    }

    if (path === '/api/me' && req.method === 'GET') {
      if (!session) return send(res, 200, { authed: false })
      return send(res, 200, { authed: true, name: session.name || '', visits: q.countVisits.get(session.sub).n })
    }

    // ── Fortschritt lesen ──────────────────────────────────────────────────
    if (path === '/api/progress' && req.method === 'GET') {
      if (!session) return send(res, 401, { error: 'unauthenticated' })
      const visited = {}
      for (const r of q.getVisits.all(session.sub)) visited[r.qid] = r.ts
      return send(res, 200, { v: 1, visited })
    }

    // ── Fortschritt sichern (Union-Merge, gibt den Gesamtstand zurück) ─────
    if (path === '/api/progress' && req.method === 'PUT') {
      if (!session) return send(res, 401, { error: 'unauthenticated' })
      let body
      try { body = JSON.parse(await readBody(req)) } catch (e) { return send(res, 400, { error: 'bad_json' }) }
      const parsed = parseProgress(body)
      if (!parsed) return send(res, 400, { error: 'bad_progress' })
      putVisits(session.sub, parsed.visited)
      const visited = {}
      for (const r of q.getVisits.all(session.sub)) visited[r.qid] = r.ts
      return send(res, 200, { v: 1, visited, dropped: parsed.dropped })
    }

    return send(res, 404, { error: 'not_found' })
  } catch (e) {
    console.error('unhandled', e)
    return send(res, 500, { error: 'server_error' })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`kiezfinder-api on 127.0.0.1:${PORT} (origin ${ORIGIN})`))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => { db.close(); process.exit(0) }) })
