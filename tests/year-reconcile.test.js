// Unit tests for tools/lib/year-reconcile.mjs — the pure decision behind
// reconcile-poi-year-facts.mjs (strips a POI year-chip that contradicts the
// Wikipedia extract's prose, without ever asserting a replacement year).
// Anlass: S-Bahnhof Köllnische Heide zeigte „Eröffnet 1993" (Wikidata-
// Wiedereröffnung), der Text sagt „1920 eröffnet". Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contradictoryYear, reconcileFacts, isYearFact, stripLifeDates } from '../tools/lib/year-reconcile.mjs'

test('isYearFact erkennt nur Jahr-Eckdaten', () => {
  assert.ok(isYearFact('Eröffnet 1993'))
  assert.ok(isYearFact('Erbaut 1908'))
  assert.ok(isYearFact('Angelegt 1734'))
  assert.equal(isYearFact('Architekt: Karl Cornelius'), false)
  assert.equal(isYearFact('47 m hoch'), false)
  assert.equal(isYearFact('Eröffnet'), false) // ohne Jahr
})

test('der gemeldete Fall: „Eröffnet 1993" widerspricht „1920 eröffnet" → Widerspruch', () => {
  const x = 'Der Bahnhof Köllnische Heide ist ein Haltepunkt der S-Bahn … und wurde im Jahr 1920 eröffnet.'
  assert.deepEqual(contradictoryYear('Eröffnet 1993', x), [1920])
})

test('korroboriertes Chip-Jahr (steht im Text) bleibt unangetastet', () => {
  // Reichstag: Chip 1894 kommt im Text vor → kein Widerspruch
  assert.equal(contradictoryYear('Erbaut 1894', 'von 1884 bis 1894 errichtet'), null)
  // exakte Eröffnung im Text
  assert.equal(contradictoryYear('Eröffnet 2019', 'wurde 2019 eröffnet'), null)
})

test('Architekten-Geburtsjahr in Klammern zählt NICHT als Baujahr (James-Simon-Galerie)', () => {
  const x = 'Die James-Simon-Galerie … wurde von 2009 bis 2018 nach Plänen von David Chipperfield (* 1953) erbaut.'
  // „(* 1953) erbaut" darf nicht als Widerspruch zu Chip 2019 zählen
  assert.equal(contradictoryYear('Erbaut 2019', x), null)
})

test('„Wiedereröffnung" ist kein Erst-Eröffnungsjahr (Ägyptisches Museum)', () => {
  const x = 'Das Ägyptische Museum … befindet sich seit dessen Wiedereröffnung im Oktober 2009 wieder im Neuen Museum.'
  assert.equal(contradictoryYear('Erbaut 1828', x), null) // 2009 = Wiedereröffnung, ignoriert
})

test('stripLifeDates entfernt Klammer-Lebensdaten + freistehende * / †', () => {
  assert.equal(/1953/.test(stripLifeDates('Chipperfield (* 1953) erbaut')), false)
  assert.equal(/1849|1932/.test(stripLifeDates('Cornelius (1849–1932)')), false)
  assert.equal(/1867|1940/.test(stripLifeDates('(* 1867; † 1940)')), false)
  assert.ok(/1920/.test(stripLifeDates('1920 eröffnet'))) // echte Jahre bleiben
})

test('kein Verb-nahes Jahr im Text → nicht anfassen (Chip evtl. korrekt, nur nicht im 2-Satz-Extrakt)', () => {
  // Text erwähnt gar kein Eröffnungsjahr → Chip bleibt
  assert.equal(contradictoryYear('Erbaut 1886', 'Ein Museum in Berlin-Mitte mit bedeutender Sammlung.'), null)
})

test('reconcileFacts entfernt nur den Jahr-Chip, behält den Rest', () => {
  const facts = ['Eröffnet 1993', 'Architekt: Karl Cornelius']
  const x = 'Er wurde im Jahr 1920 eröffnet.'
  const r = reconcileFacts(facts, x)
  assert.deepEqual(r.facts, ['Architekt: Karl Cornelius'])
  assert.equal(r.dropped.chip, 1993)
  assert.deepEqual(r.dropped.textYears, [1920])
  assert.deepEqual(facts, ['Eröffnet 1993', 'Architekt: Karl Cornelius']) // nicht-mutierend
})

test('reconcileFacts lässt korrekte/kontextlose Fakten unangetastet', () => {
  assert.equal(reconcileFacts(['Erbaut 1894', '47 m hoch'], 'von 1884 bis 1894 errichtet').dropped, null)
  assert.equal(reconcileFacts([], 'egal').dropped, null)
  assert.equal(reconcileFacts(['Architekt: X'], 'egal').dropped, null) // kein Jahr-Chip
})
