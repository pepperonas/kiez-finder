// Unit tests for src/account.js — the optional account/progress sync client.
// Every function degrades to a harmless value on failure (backend down, offline,
// login refused) so the static app never breaks. The module touches its globals
// (fetch, location, history) only at CALL time → plain global stubs, no jsdom.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchMe, fetchProgress, pushProgress, logout, syncProgress,
  loginUrl, readLoginFlag, stripLoginFlag,
} from '../src/account.js'

// ── global stubs ─────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

/** Install a fetch stub; returns the recorded calls. `handler(url, init)` yields
 *  the response (or throws to simulate a network error). */
function mockFetch(handler) {
  const calls = []
  setGlobal('fetch', async (url, init) => { calls.push({ url: String(url), init }); return handler(url, init) })
  return calls
}
const res = (body, ok = true) => ({ ok, json: async () => body })
const isPut = (init) => !!init && init.method === 'PUT'

test.after(() => { globalThis.fetch = realFetch })

// ── fetchMe ──────────────────────────────────────────────────────────────────
test('fetchMe: ok → parsed JSON body', async () => {
  mockFetch(() => res({ authed: true, name: 'Ada', visited: {} }))
  assert.deepEqual(await fetchMe(), { authed: true, name: 'Ada', visited: {} })
})
test('fetchMe: non-ok response → offline sentinel', async () => {
  mockFetch(() => res({}, false))
  assert.deepEqual(await fetchMe(), { authed: false, offline: true })
})
test('fetchMe: thrown fetch → offline sentinel (never throws)', async () => {
  mockFetch(() => { throw new Error('network') })
  assert.deepEqual(await fetchMe(), { authed: false, offline: true })
})

// ── fetchProgress ──────────────────────────────────────────────────────────
test('fetchProgress: ok + visited → the object', async () => {
  mockFetch(() => res({ visited: { 1: 100 } }))
  assert.deepEqual(await fetchProgress(), { visited: { 1: 100 } })
})
test('fetchProgress: ok but no visited field → null', async () => {
  mockFetch(() => res({ hello: 1 }))
  assert.equal(await fetchProgress(), null)
})
test('fetchProgress: non-ok → null', async () => {
  mockFetch(() => res({ visited: {} }, false))
  assert.equal(await fetchProgress(), null)
})
test('fetchProgress: thrown fetch → null', async () => {
  mockFetch(() => { throw new Error('x') })
  assert.equal(await fetchProgress(), null)
})
test('fetchProgress: ok but null body → null (d itself falsy)', async () => {
  mockFetch(() => res(null))
  assert.equal(await fetchProgress(), null)
})

// ── pushProgress ─────────────────────────────────────────────────────────────
test('pushProgress: PUTs { visited } as JSON to /api/progress', async () => {
  const calls = mockFetch(() => res({ visited: { 2: 50 } }))
  const out = await pushProgress({ visited: { 2: 50 } })
  assert.deepEqual(out, { visited: { 2: 50 } })
  const { url, init } = calls[0]
  assert.match(url, /\/api\/progress$/)
  assert.equal(init.method, 'PUT')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(init.body), { visited: { 2: 50 } })
})
test('pushProgress: missing visited → sends an empty object', async () => {
  const calls = mockFetch(() => res({ visited: {} }))
  await pushProgress({})
  assert.deepEqual(JSON.parse(calls[0].init.body), { visited: {} })
})
test('pushProgress: non-ok → null', async () => {
  mockFetch(() => res({ visited: {} }, false))
  assert.equal(await pushProgress({ visited: {} }), null)
})
test('pushProgress: ok but no visited in the reply → null', async () => {
  mockFetch(() => res({ ok: 1 }))
  assert.equal(await pushProgress({ visited: {} }), null)
})
test('pushProgress: thrown fetch → null', async () => {
  mockFetch(() => { throw new Error('x') })
  assert.equal(await pushProgress({ visited: {} }), null)
})
test('pushProgress: ok but null body → null (d itself falsy)', async () => {
  mockFetch(() => res(null))
  assert.equal(await pushProgress({ visited: {} }), null)
})

// ── logout ───────────────────────────────────────────────────────────────────
test('logout: POSTs the logout endpoint', async () => {
  const calls = mockFetch(() => res({}))
  await logout()
  assert.match(calls[0].url, /\/api\/auth\/logout$/)
  assert.equal(calls[0].init.method, 'POST')
})
test('logout: swallows network errors (never throws)', async () => {
  mockFetch(() => { throw new Error('down') })
  await assert.doesNotReject(logout())
})

// ── syncProgress ─────────────────────────────────────────────────────────────
test('syncProgress: no remote → null, and never uploads', async () => {
  let pushed = false
  mockFetch((_u, init) => { if (isPut(init)) pushed = true; return res({}, false) })
  const merge = () => { throw new Error('must not merge without a remote') }
  assert.equal(await syncProgress({ visited: {} }, merge), null)
  assert.equal(pushed, false)
})
test('syncProgress: merges local ∪ remote and uploads the merge', async () => {
  const remote = { visited: { 1: 100 } }
  const local = { visited: { 2: 200 } }
  const merged = { visited: { 1: 100, 2: 200 } }
  const calls = mockFetch((_u, init) => (isPut(init) ? res(merged) : res(remote)))
  let mergeArgs = null
  const out = await syncProgress(local, (a, b) => { mergeArgs = [a, b]; return merged })
  assert.deepEqual(mergeArgs, [local, remote])                          // merge(local, remote)
  assert.deepEqual(JSON.parse(calls[1].init.body), { visited: merged.visited }) // uploaded the merge
  assert.deepEqual(out, merged)                                         // server-confirmed total
})
test('syncProgress: upload fails → the merge still applies locally', async () => {
  const merged = { visited: { 1: 100, 2: 200 } }
  mockFetch((_u, init) => (isPut(init) ? res({}, false) : res({ visited: { 1: 100 } })))
  const out = await syncProgress({ visited: { 2: 200 } }, () => merged)
  assert.deepEqual(out, merged) // saved || merged
})

// ── login helpers ────────────────────────────────────────────────────────────
test('loginUrl points at the Google auth route', () => {
  assert.equal(loginUrl(), '/api/auth/google')
})
test('readLoginFlag extracts ok / fehler, else null', () => {
  assert.equal(readLoginFlag('?login=ok'), 'ok')
  assert.equal(readLoginFlag('?foo=1&login=fehler'), 'fehler')
  assert.equal(readLoginFlag('?login=oktober'), null) // \b guards against a prefix match
  assert.equal(readLoginFlag('?other=1'), null)
  assert.equal(readLoginFlag(''), null)
})
test('readLoginFlag defaults to location.search when called with no argument', () => {
  setGlobal('location', { search: '?login=ok' })
  assert.equal(readLoginFlag(), 'ok')
})
test('stripLoginFlag removes only the login param via history.replaceState', () => {
  let replaced = null
  setGlobal('location', { href: 'https://kiezfinder.celox.io/app?login=ok&a=1#h' })
  setGlobal('history', { replaceState: (_s, _t, url) => { replaced = url } })
  stripLoginFlag()
  assert.equal(replaced, '/app?a=1#h')
})
test('stripLoginFlag swallows errors (unparseable location / throwing history)', () => {
  setGlobal('location', { href: 'not a url' })
  setGlobal('history', { replaceState: () => { throw new Error('no') } })
  assert.doesNotThrow(() => stripLoginFlag())
})
