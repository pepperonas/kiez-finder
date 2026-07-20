// Unit tests für die sicherheitskritischen, reinen Teile des Backends
// (server/lib/*): Session-Signatur (Fälschung, Ablauf, Manipulation),
// Cookie-Parsing und die Validierung des Fortschritts-Uploads.
// Kein Server, keine DB nötig — reine Funktionen mit injiziertem Secret.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sign, verify, newSession, parseCookies, cookieHeader, clearCookie, randomState,
  COOKIE, SESSION_DAYS,
} from '../server/lib/session.js'
import { parseProgress, mergeVisited, MAX_VISITS, MIN_TS } from '../server/lib/validate.js'

const SECRET = 'test-secret-0123456789'
const NOW = Date.UTC(2026, 6, 20)

// ── Session-Signatur ─────────────────────────────────────────────────────────
test('sign/verify: gültige Runde liefert die Nutzlast zurück', () => {
  const payload = newSession('google-sub-123', 'Martin', NOW)
  const p = verify(sign(payload, SECRET), SECRET, NOW)
  assert.equal(p.sub, 'google-sub-123')
  assert.equal(p.name, 'Martin')
  assert.equal(p.exp, NOW + SESSION_DAYS * 864e5)
})

test('verify weist FREMD signierte Tokens ab (kein Login mit geratenem Secret)', () => {
  const token = sign(newSession('angreifer', 'X', NOW), 'falsches-secret')
  assert.equal(verify(token, SECRET, NOW), null)
})

test('verify weist manipulierte Nutzlast ab (sub kann nicht getauscht werden)', () => {
  const token = sign(newSession('user-a', 'A', NOW), SECRET)
  const [body, mac] = token.split('.')
  const evil = Buffer.from(JSON.stringify({ sub: 'user-b', name: 'B', exp: NOW + 1e9 })).toString('base64url')
  assert.equal(verify(`${evil}.${mac}`, SECRET, NOW), null) // Signatur passt nicht mehr
  assert.ok(verify(`${body}.${mac}`, SECRET, NOW), 'Original bleibt gültig')
})

test('verify weist abgelaufene Sessions ab', () => {
  const token = sign({ sub: 'x', name: '', exp: NOW - 1 }, SECRET)
  assert.equal(verify(token, SECRET, NOW), null)
  assert.ok(verify(sign({ sub: 'x', name: '', exp: NOW + 1000 }, SECRET), SECRET, NOW))
})

test('verify ist robust gegen Müll-Cookies (nie ein Throw)', () => {
  for (const junk of [undefined, null, '', 'abc', 'a.b', '...', 'x'.repeat(500), 42, {},
    Buffer.from('{}').toString('base64url') + '.zzz']) {
    assert.equal(verify(junk, SECRET, NOW), null, String(junk).slice(0, 20))
  }
  // gültige Signatur, aber Pflichtfelder fehlen
  assert.equal(verify(sign({ name: 'ohne sub', exp: NOW + 1000 }, SECRET), SECRET, NOW), null)
  assert.equal(verify(sign({ sub: 'x' }, SECRET), SECRET, NOW), null) // ohne exp
})

test('newSession kappt überlange Anzeigenamen', () => {
  assert.equal(newSession('s', 'x'.repeat(200), NOW).name.length, 60)
  assert.equal(newSession('s', undefined, NOW).name, '')
})

test('randomState liefert unterschiedliche, ausreichend lange Werte (CSRF-state)', () => {
  const a = randomState(), b = randomState()
  assert.notEqual(a, b)
  assert.ok(a.length >= 20)
})

// ── Cookies ──────────────────────────────────────────────────────────────────
test('parseCookies liest mehrere Cookies, dekodiert und ignoriert Schrott', () => {
  const c = parseCookies('kf_sess=abc.def; theme=dark; leer; weird=a%20b')
  assert.equal(c.kf_sess, 'abc.def')
  assert.equal(c.theme, 'dark')
  assert.equal(c.weird, 'a b')
  assert.equal('leer' in c, false)
  assert.deepEqual(parseCookies(undefined), {})
  assert.deepEqual(parseCookies(''), {})
  // erstes Vorkommen gewinnt (Cookie-Shadowing verhindern)
  assert.equal(parseCookies('a=1; a=2').a, '1')
})

test('cookieHeader setzt HttpOnly/SameSite/Secure, clearCookie läuft sofort ab', () => {
  const h = cookieHeader(COOKIE, 'tok', { maxAge: 60, secure: true })
  assert.match(h, /^kf_sess=tok/)
  assert.match(h, /HttpOnly/)
  assert.match(h, /SameSite=Lax/)
  assert.match(h, /Secure/)
  assert.match(h, /Max-Age=60/)
  assert.match(clearCookie(COOKIE, { secure: true }), /Max-Age=0/)
  assert.equal(/Secure/.test(cookieHeader(COOKIE, 'x', { secure: false })), false) // lokal ohne HTTPS
})

// ── Upload-Validierung ───────────────────────────────────────────────────────
test('parseProgress nimmt gültige Einträge und verwirft einzelne kaputte', () => {
  const r = parseProgress({ visited: { 82425: MIN_TS + 1000, 156721: MIN_TS + 2000 } }, MIN_TS + 5000)
  assert.deepEqual(r.visited, { 82425: MIN_TS + 1000, 156721: MIN_TS + 2000 })
  assert.equal(r.dropped, 0)
  // Schrott fliegt raus, der Rest bleibt erhalten
  const mixed = parseProgress({ visited: {
    82425: MIN_TS + 1000,        // ok
    'abc': MIN_TS + 1000,        // keine QID
    '-5': MIN_TS + 1000,         // negativ
    '99999999999': MIN_TS + 100, // zu groß
    777: 12345,                  // Zeitstempel vor der Jagd
    888: 'gestern',              // kein Zeitstempel
  } }, MIN_TS + 5000)
  assert.deepEqual(mixed.visited, { 82425: MIN_TS + 1000 })
  assert.equal(mixed.dropped, 5)
})

test('parseProgress lehnt grundsätzlich unbrauchbare Rümpfe ab', () => {
  for (const bad of [null, undefined, 'text', 42, {}, { visited: null }, { visited: 'x' }, { visited: [] }]) {
    assert.equal(parseProgress(bad), null, JSON.stringify(bad))
  }
})

test('parseProgress deckelt die Menge (kein Massen-Upload)', () => {
  const many = {}
  for (let i = 1; i <= MAX_VISITS + 1; i++) many[i] = MIN_TS + 1000
  assert.equal(parseProgress({ visited: many }, MIN_TS + 5000), null)
})

test('parseProgress akzeptiert keine Zeitstempel weit in der Zukunft', () => {
  const now = MIN_TS + 5000
  assert.equal(parseProgress({ visited: { 1: now + 864e5 * 3 } }, now).dropped, 1)
  assert.equal(Object.keys(parseProgress({ visited: { 1: now + 1000 } }, now).visited).length, 1) // leichte Uhr-Abweichung ok
})

test('mergeVisited: Union, früherer Erstbesuch gewinnt, kommutativ', () => {
  const a = { 1: 500, 2: 800 }, b = { 2: 300, 3: 900 }
  assert.deepEqual(mergeVisited(a, b), { 1: 500, 2: 300, 3: 900 })
  assert.deepEqual(mergeVisited(a, b), mergeVisited(b, a))
  assert.deepEqual(mergeVisited(null, b), b)
  assert.deepEqual(mergeVisited(a, null), a)
})
