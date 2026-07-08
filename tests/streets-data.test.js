// Dataset tests for public/data/strassen.json — the Overpass-derived index of
// every named Berlin street (built by tools/build-streets.js). Guards the
// compact record shape the app relies on and plausibility of the content.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('../public/data/strassen.json', import.meta.url), 'utf8'))

test('dataset shape: version, Bezirk table, street records', () => {
  assert.equal(data.v, 1)
  assert.equal(data.bez.length, 12) // all 12 Bezirke
  assert.ok(Array.isArray(data.streets))
  for (const s of data.streets.slice(0, 200)) {
    assert.equal(s.length, 8) // [name, bezIdx, cx, cy, x1, y1, x2, y2]
    assert.equal(typeof s[0], 'string')
    assert.ok(Number.isInteger(s[1]) && s[1] >= -1 && s[1] < 12)
  }
})

test('coverage: ≥ 10,000 street entries, ≥ 9,000 unique names', () => {
  assert.ok(data.streets.length >= 10000, `${data.streets.length} entries`)
  assert.ok(new Set(data.streets.map((s) => s[0])).size >= 9000)
})

test('well-known streets are present with the right Bezirk', () => {
  const bezOf = (name) => data.streets.filter((s) => s[0] === name).map((s) => data.bez[s[1]])
  assert.deepEqual(bezOf('Unter den Linden'), ['Mitte'])
  assert.ok(bezOf('Sonnenallee').includes('Neukölln'))
  assert.ok(bezOf('Kurfürstendamm').includes('Charlottenburg-Wilmersdorf'))
  assert.ok(bezOf('Karl-Marx-Allee').includes('Friedrichshain-Kreuzberg') || bezOf('Karl-Marx-Allee').includes('Mitte'))
  assert.ok(bezOf('Hauptstraße').length >= 5) // the classic many-Hauptstraßen case
})

test('geometry sanity: centers inside Berlin bounds and inside their bbox', () => {
  for (const [, , cx, cy, x1, y1, x2, y2] of data.streets) {
    assert.ok(cx >= 13.0 && cx <= 13.8 && cy >= 52.3 && cy <= 52.7, `center off Berlin: ${cx},${cy}`)
    assert.ok(x1 <= cx && cx <= x2 && y1 <= cy && cy <= y2, 'center outside bbox')
    assert.ok(x1 <= x2 && y1 <= y2, 'degenerate bbox')
  }
})

test('same-named clusters are spatially distinct (no duplicate merge artifacts)', () => {
  const groups = new Map()
  for (const s of data.streets) {
    if (!groups.has(s[0])) groups.set(s[0], [])
    groups.get(s[0]).push(s)
  }
  for (const [name, list] of groups) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.hypot(list[i][2] - list[j][2], list[i][3] - list[j][3])
        assert.ok(d > 0.002, `near-duplicate clusters for ${name}`)
      }
  }
})
