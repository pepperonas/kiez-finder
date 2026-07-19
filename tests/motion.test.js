// Unit tests for src/motion.js — the M3-Expressive spring integrator that
// drives all spatial motion. The module reads its globals (window.matchMedia,
// requestAnimationFrame, performance) at CALL time, so it tests in Node with
// a fake clock + an auto-pumping rAF stub: every scheduled frame runs on a
// 0-ms timer and advances the clock by one 60fps step — deterministic
// integration, no real time passes.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPRINGS, reduceMotion, finePointer, spring, tweenNumber, revealStagger, damdamper } from '../src/motion.js'

// ── fake clock + auto-pumping rAF ────────────────────────────────────────────
let clock = 0
let rmFlag = false // prefers-reduced-motion
let fpFlag = true  // fine pointer
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

setGlobal('window', {
  matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? rmFlag : fpFlag }),
})
const realPerfNow = performance.now.bind(performance)
performance.now = () => clock
setGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb((clock += 1000 / 60)), 0))
setGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
test.after(() => { performance.now = realPerfNow })

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms)) // real ms — enough timer ticks to converge

// ── media queries ────────────────────────────────────────────────────────────
test('reduceMotion / finePointer reflect the live matchMedia state', () => {
  rmFlag = false; fpFlag = true
  assert.equal(reduceMotion(), false)
  assert.equal(finePointer(), true)
  rmFlag = true; fpFlag = false
  assert.equal(reduceMotion(), true)
  assert.equal(finePointer(), false)
  rmFlag = false; fpFlag = true
})

// ── spring ───────────────────────────────────────────────────────────────────
test('spring converges exactly to the target and calls onDone', async () => {
  const seen = []
  let done = false
  spring(0, 100, SPRINGS.spatialDefault, (v) => seen.push(v), () => { done = true })
  await settle(200)
  assert.ok(done, 'onDone fired')
  assert.equal(seen[seen.length - 1], 100) // snapped exactly, not just close
  assert.ok(seen.length > 5, 'animated over multiple frames')
})

test('spring with damping 0.6 (spatial-fast) overshoots — the signature bounce', async () => {
  const seen = []
  spring(0, 100, SPRINGS.spatialFast, (v) => seen.push(v))
  await settle(200)
  const max = Math.max(...seen)
  assert.ok(max > 100.5, `underdamped spring must overshoot the target (max was ${max})`)
  assert.equal(seen[seen.length - 1], 100) // ...and still settle exactly
})

test('spring with damping 0.8 (spatial-default) stays essentially overshoot-free', async () => {
  const seen = []
  spring(0, 100, SPRINGS.spatialDefault, (v) => seen.push(v))
  await settle(200)
  assert.ok(Math.max(...seen) < 102, 'well-damped: no signature bounce')
})

test('spring honors reduced motion: one synchronous jump to the target', () => {
  rmFlag = true
  const seen = []
  let done = false
  const cancel = spring(0, 100, SPRINGS.spatialFast, (v) => seen.push(v), () => { done = true })
  assert.deepEqual(seen, [100]) // immediate, no frames
  assert.ok(done)
  assert.equal(typeof cancel, 'function') // still returns a (noop) cancel
  rmFlag = false
})

test('the cancel fn stops the spring mid-flight', async () => {
  const seen = []
  const cancel = spring(0, 100, SPRINGS.spatialSlow, (v) => seen.push(v))
  await settle(10) // a few frames in...
  cancel()
  const at = seen.length
  await settle(100)
  assert.equal(seen.length, at, 'no updates after cancel')
  assert.notEqual(seen[seen.length - 1], 100, 'was still mid-flight')
})

// ── tweenNumber ──────────────────────────────────────────────────────────────
test('tweenNumber eases to the target and formats every frame', async () => {
  const el = { textContent: '' }
  tweenNumber(el, 0, 50, (v) => v.toFixed(1), 100)
  await settle(100)
  assert.equal(el.textContent, '50.0')
})

test('tweenNumber under reduced motion sets the formatted target synchronously', () => {
  rmFlag = true
  const el = { textContent: '' }
  tweenNumber(el, 0, 50, (v) => `#${v}`)
  assert.equal(el.textContent, '#50')
  rmFlag = false
})

// ── revealStagger ────────────────────────────────────────────────────────────
const fakeEl = () => {
  const props = {}
  return { props, style: { setProperty: (k, v) => { props[k] = v } } }
}

test('revealStagger primes elements hidden, then reveals them (staggered)', async () => {
  const els = [fakeEl(), fakeEl(), fakeEl()]
  revealStagger(els, { base: 10, jitter: 5, distance: 18 })
  // primed synchronously: hidden + shifted down
  for (const e of els) {
    assert.equal(e.props['--reveal'], '0')
    assert.equal(e.props['--reveal-y'], '18px')
  }
  await settle(300)
  for (const e of els) {
    assert.equal(e.props['--reveal'], '1')
    assert.equal(e.props['--reveal-y'], '0.00px') // spring settled at 0
  }
})

test('revealStagger under reduced motion reveals everything synchronously', () => {
  rmFlag = true
  const els = [fakeEl(), fakeEl()]
  revealStagger(els)
  for (const e of els) {
    assert.equal(e.props['--reveal'], '1')
    assert.equal(e.props['--reveal-y'], '0px')
  }
  rmFlag = false
})

// ── damdamper ────────────────────────────────────────────────────────────────
test('damdamper chases the target with inertia and settles on it', async () => {
  const frames = []
  const d = damdamper((x, y) => frames.push([x, y]))
  d.set(4, -2)
  await settle(200)
  const [x, y] = frames[frames.length - 1]
  assert.ok(Math.abs(x - 4) < 0.01 && Math.abs(y - -2) < 0.01, `settled near target (got ${x}, ${y})`)
  assert.ok(frames.length > 5, 'moved over multiple frames — inertia, not a jump')
})

test('damdamper.stop() halts the loop', async () => {
  const frames = []
  const d = damdamper((x, y) => frames.push([x, y]))
  d.set(10, 10)
  await settle(10)
  d.stop()
  const at = frames.length
  await settle(100)
  assert.equal(frames.length, at)
})
