// Unit tests for src/datapath.js — the shared data-directory that every data
// loader (kiez/stats/heat/hunt) resolves fetch paths through. Switching city
// repoints all of them at once; Berlin ('/data') is the default.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dpath, setDataDir, dataDir } from '../src/datapath.js'

test('defaults to /data and joins a filename (Berlin, backward-compatible)', () => {
  assert.equal(dataDir(), '/data')
  assert.equal(dpath('kieze.geojson'), '/data/kieze.geojson')
})

test('setDataDir repoints every subsequent path; falsy → back to /data', () => {
  setDataDir('/data/frankfurt')
  assert.equal(dataDir(), '/data/frankfurt')
  assert.equal(dpath('stats.json'), '/data/frankfurt/stats.json')
  assert.equal(dpath('strassen.json'), '/data/frankfurt/strassen.json')

  setDataDir(undefined) // unset → Berlin-Default
  assert.equal(dataDir(), '/data')
  setDataDir('') // ebenfalls Default
  assert.equal(dpath('x.json'), '/data/x.json')
})
