// Unit tests for src/topbarLayout.js — which topbar actions stay in the bar and
// which collapse into the overflow menu. DOM-free rule, so it is testable
// without a browser (main.js only moves the elements accordingly).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  topbarPlan, compactSlots, isCompact, ACTION_ORDER, COMPACT_SLOTS, NARROW_SLOTS,
  NARROW_WIDTH, COMPACT_MAX_WIDTH, searchEscapeAction,
} from '../src/topbarLayout.js'

const keys = (p) => [...p.bar, ...p.menu]

test('the compact threshold sits ABOVE the 840px panel breakpoint', () => {
  // measured: at 840px the full row leaves the search box 129px — narrower than
  // its own placeholder. Collapsing until 1000px gives it 304px instead.
  assert.ok(COMPACT_MAX_WIDTH > 840)
  assert.equal(isCompact(839), true)
  assert.equal(isCompact(840), true, 'the desktop panel appears, the full action row does not')
  assert.equal(isCompact(COMPACT_MAX_WIDTH - 1), true)
  assert.equal(isCompact(COMPACT_MAX_WIDTH), false)
  assert.equal(isCompact(1440), false)
})

test('desktop keeps every action in the bar (no overflow menu)', () => {
  const p = topbarPlan({ compact: false, width: 1440, hasWall: true })
  assert.deepEqual(p.bar, ACTION_ORDER)
  assert.deepEqual(p.menu, [])
})

test('compact shows the map layers + the city signature feature, rest overflows', () => {
  const p = topbarPlan({ compact: true, width: 390, hasWall: true })
  assert.deepEqual(p.bar, ['overlay', 'heat', 'wall'])
  assert.deepEqual(p.menu, ['autozoom', 'account', 'theme', 'install'])
})

test('below 360px one slot less — nothing shrinks under the 48dp target instead', () => {
  const p = topbarPlan({ compact: true, width: 320, hasWall: true })
  assert.equal(p.bar.length, NARROW_SLOTS)
  assert.deepEqual(p.bar, ['overlay', 'heat'])
  assert.ok(p.menu.includes('wall'))
  assert.equal(compactSlots(NARROW_WIDTH - 0.5), NARROW_SLOTS)
  assert.equal(compactSlots(NARROW_WIDTH), COMPACT_SLOTS, 'exactly 360 already gets the full row')
})

test('a city without the Mauer feature never offers it — and promotes the next action', () => {
  for (const width of [320, 390, 1440]) {
    const p = topbarPlan({ compact: isCompact(width), width, hasWall: false })
    assert.ok(!keys(p).includes('wall'), `wall leaked at ${width}px`)
  }
  // the freed slot goes to the next action by priority instead of staying empty
  assert.deepEqual(topbarPlan({ compact: true, width: 390, hasWall: false }).bar,
    ['overlay', 'heat', 'autozoom'])
})

test('install never takes a bar slot on phones (it is hidden until installable)', () => {
  for (const [width, hasWall] of [[320, true], [360, true], [390, false], [430, true]]) {
    const p = topbarPlan({ compact: true, width, hasWall })
    assert.ok(!p.bar.includes('install'), `install claimed a slot at ${width}px`)
    assert.ok(p.menu.includes('install'))
  }
})

test('bar + menu partition the available actions — nothing lost, nothing twice', () => {
  for (const compact of [true, false]) {
    for (const width of [320, 360, 390, 430, 700, 1440]) {
      for (const hasWall of [true, false]) {
        const p = topbarPlan({ compact, width, hasWall })
        const all = keys(p)
        assert.equal(new Set(all).size, all.length, 'duplicate action')
        const expected = ACTION_ORDER.filter((k) => k !== 'wall' || hasWall)
        assert.deepEqual([...all].sort(), [...expected].sort())
      }
    }
  }
})

test('the overflow menu is never empty when it is shown', () => {
  // main.js hides the "more" button on an empty menu; a compact plan must always
  // produce one, otherwise the collapsed actions would be unreachable
  for (const width of [320, 390, 700]) {
    assert.ok(topbarPlan({ compact: true, width, hasWall: false }).menu.length > 0)
  }
})

test('defaults are safe when called without options', () => {
  const p = topbarPlan()
  assert.deepEqual(p.menu, [], 'no compact flag → desktop layout')
  assert.ok(p.bar.length > 0)
})

test('ESC in the search: at most two stages (results → search view)', () => {
  assert.equal(searchEscapeAction({ resultsOpen: true, compactOpen: true }), 'closeResults')
  assert.equal(searchEscapeAction({ resultsOpen: true, compactOpen: false }), 'closeResults')
  // compact phone row: second ESC closes the whole search, it does not just empty it
  assert.equal(searchEscapeAction({ resultsOpen: false, compactOpen: true }), 'closeSearch')
  // desktop: the row is permanent, so ESC clears the field instead
  assert.equal(searchEscapeAction({ resultsOpen: false, compactOpen: false }), 'clearInput')
})
