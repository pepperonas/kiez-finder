// Testet die AUTORITATIVE-REPLACE-Semantik des Fortschritts-Uploads gegen ein
// In-Memory-Abbild der echten Server-Queries (server.js ist HTTP+OAuth und
// nicht headless startbar; die Kern-Datenlogik ist die putVisits-Transaktion).
// Entscheidend: ein zurückgenommener Besuch muss den Server VERLASSEN — sonst
// würde der Union-Merge Fehleingaben nie los.
//
// better-sqlite3 ist Root-devDependency → im Test/CI immer vorhanden.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const Database = createRequire(import.meta.url)('better-sqlite3')

// Nachbau der putVisits-Transaktion aus server/server.js (1:1 dieselben Queries)
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE visits (sub TEXT, qid INTEGER, ts INTEGER, PRIMARY KEY (sub,qid)) WITHOUT ROWID;`)
  const put = db.prepare(`INSERT INTO visits (sub,qid,ts) VALUES (?,?,?)
    ON CONFLICT(sub,qid) DO UPDATE SET ts = MIN(ts, excluded.ts)`)
  const delMissing = db.prepare('DELETE FROM visits WHERE sub = ? AND qid NOT IN (SELECT value FROM json_each(?))')
  const delAll = db.prepare('DELETE FROM visits WHERE sub = ?')
  const get = db.prepare('SELECT qid, ts FROM visits WHERE sub = ? ORDER BY qid')
  const putVisits = db.transaction((sub, visited) => {
    const qids = Object.keys(visited).map(Number)
    if (qids.length) delMissing.run(sub, JSON.stringify(qids))
    else delAll.run(sub)
    for (const [qid, ts] of Object.entries(visited)) put.run(sub, Number(qid), ts)
  })
  return { putVisits, read: (sub) => Object.fromEntries(get.all(sub).map((r) => [r.qid, r.ts])) }
}

test('PUT ersetzt autoritativ: Zurücknehmen entfernt den Besuch auch serverseitig', () => {
  const { putVisits, read } = makeDb()
  putVisits('u', { 1: 1000, 2: 2000, 3: 3000 })
  assert.deepEqual(read('u'), { 1: 1000, 2: 2000, 3: 3000 })
  // Client nimmt POI 2 zurück und lädt den reduzierten Stand hoch
  putVisits('u', { 1: 1000, 3: 3000 })
  assert.deepEqual(read('u'), { 1: 1000, 3: 3000 }, 'POI 2 ist weg — nicht wieder auferstanden')
})

test('PUT dedupt Zeitstempel per MIN (früherer Erstbesuch gewinnt innerhalb des Uploads)', () => {
  const { putVisits, read } = makeDb()
  putVisits('u', { 1: 5000 })
  putVisits('u', { 1: 2000 }) // früher → gewinnt
  putVisits('u', { 1: 9000 }) // später → ignoriert
  assert.equal(read('u')[1], 2000)
})

test('PUT mit leerem Satz löscht alles (kompletter Reset), Nutzer bleiben getrennt', () => {
  const { putVisits, read } = makeDb()
  putVisits('a', { 1: 1000, 2: 2000 })
  putVisits('b', { 9: 9000 })
  putVisits('a', {}) // a setzt alles zurück
  assert.deepEqual(read('a'), {})
  assert.deepEqual(read('b'), { 9: 9000 }, 'anderer Nutzer unberührt')
})
