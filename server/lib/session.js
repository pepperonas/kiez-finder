// Signierte, zustandslose Session-Cookies (HMAC-SHA256) — kein Session-Store,
// kein Redis. Nutzlast ist bewusst winzig: nur die Google-`sub` (stabile ID),
// ein Anzeigename und ein Ablauf. KEINE E-Mail, keine Tokens.
//
// Pure + injizierbar (Secret als Argument) → unit-testbar ohne Server.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

export const SESSION_DAYS = 180
export const COOKIE = 'kf_sess'
export const STATE_COOKIE = 'kf_state'

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const unb64u = (s) => Buffer.from(s, 'base64url')

/** Signiertes Token: <payload-b64url>.<hmac-b64url> */
export function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload))
  const mac = createHmac('sha256', secret).update(body).digest()
  return `${body}.${b64u(mac)}`
}

/**
 * Token prüfen → Payload oder null. Streng: falsches Format, manipulierte
 * Signatur, abgelaufen oder fehlende Pflichtfelder ⇒ null (nie ein Throw,
 * damit ein kaputtes Cookie nie einen Request killt).
 */
export function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot), macPart = token.slice(dot + 1)
  let given, expect
  try {
    given = unb64u(macPart)
    expect = createHmac('sha256', secret).update(body).digest()
  } catch (e) { return null }
  // Längenungleichheit vor timingSafeEqual abfangen (wirft sonst)
  if (given.length !== expect.length || !timingSafeEqual(given, expect)) return null
  let payload
  try { payload = JSON.parse(unb64u(body).toString('utf8')) } catch (e) { return null }
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.sub !== 'string' || !payload.sub) return null
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null
  return payload
}

export function newSession(sub, name, now = Date.now()) {
  return { sub, name: typeof name === 'string' ? name.slice(0, 60) : '', exp: now + SESSION_DAYS * 864e5 }
}

/** Cookie-Header parsen (kein cookie-parser nötig). */
export function parseCookies(header) {
  const out = {}
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    if (!k || k in out) continue // erstes Vorkommen gewinnt
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()) } catch (e) { out[k] = part.slice(i + 1).trim() }
  }
  return out
}

export function cookieHeader(name, value, { maxAge, secure = true } = {}) {
  const p = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (secure) p.push('Secure')
  if (maxAge != null) p.push(`Max-Age=${maxAge}`)
  return p.join('; ')
}
export const clearCookie = (name, opts) => cookieHeader(name, '', { ...opts, maxAge: 0 })
export const randomState = () => randomBytes(16).toString('base64url')
