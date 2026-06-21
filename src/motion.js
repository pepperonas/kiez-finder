// ─────────────────────────────────────────────────────────────────────────
// Motion system — Material 3 Expressive springs, ported to the web.
//
// CSS has no native spring, so spatial motion (position/size/reveal, which
// should overshoot) is driven by a tiny semi-implicit Euler spring integrator
// here. Opacity/colour ("effects") stay on CSS easing — overshooting a fade
// looks broken. One timing system, reused everywhere.
//
// Spring constants are the verbatim M3 *Expressive* tokens
// (ExpressiveMotionTokens.kt): stiffness + dampingRatio.
// ─────────────────────────────────────────────────────────────────────────

export const SPRINGS = {
  spatialFast:    { stiffness: 800, damping: 0.6 }, // signature bounce
  spatialDefault: { stiffness: 380, damping: 0.8 },
  spatialSlow:    { stiffness: 200, damping: 0.8 },
  // effects springs are critically damped (no overshoot) — used rarely in JS
  effectsDefault: { stiffness: 1600, damping: 1.0 },
}

export const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const finePointer = () =>
  window.matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * Animate a scalar from `from` to `to` with an M3 Expressive spring.
 * onUpdate(value) is called each frame; returns a cancel fn.
 * Honors reduced-motion (jumps straight to `to`).
 */
export function spring(from, to, { stiffness, damping }, onUpdate, onDone) {
  if (reduceMotion()) {
    onUpdate(to)
    onDone && onDone()
    return () => {}
  }
  const k = stiffness
  const c = damping * 2 * Math.sqrt(k) // damping coefficient (mass = 1)
  let x = from
  let v = 0
  let raf = 0
  let prev = performance.now()
  let stopped = false

  const step = (now) => {
    if (stopped) return
    // clamp dt so a backgrounded tab doesn't explode the integrator
    let dt = Math.min((now - prev) / 1000, 1 / 30)
    prev = now
    // sub-step for stability at high stiffness
    const sub = 4
    const h = dt / sub
    for (let i = 0; i < sub; i++) {
      const a = -k * (x - to) - c * v
      v += a * h
      x += v * h
    }
    onUpdate(x)
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.0005) {
      x = to
      onUpdate(x)
      onDone && onDone()
      return
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}

/**
 * Count a number up/down with an emphasized-decelerate feel.
 * Used for the coordinate readout — values arrive, they don't just appear.
 */
export function tweenNumber(el, from, to, fmt, dur = 600) {
  if (reduceMotion()) {
    el.textContent = fmt(to)
    return
  }
  const start = performance.now()
  const ease = (t) => 1 - Math.pow(1 - t, 3) // easeOutCubic ≈ emphasized-decelerate
  const tick = (now) => {
    const t = Math.min((now - start) / dur, 1)
    el.textContent = fmt(from + (to - from) * ease(t))
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * Staggered reveal: each element rises + fades in, item-by-item, with a small
 * randomised offset so the list feels alive instead of synced. Spatial part
 * uses the spring; opacity uses CSS-side `--reveal` consumed by the stylesheet.
 */
export function revealStagger(els, { base = 60, jitter = 24, distance = 18 } = {}) {
  els.forEach((el, i) => {
    el.style.setProperty('--reveal', '0')
    el.style.setProperty('--reveal-y', distance + 'px')
  })
  if (reduceMotion()) {
    els.forEach((el) => {
      el.style.setProperty('--reveal', '1')
      el.style.setProperty('--reveal-y', '0px')
    })
    return
  }
  els.forEach((el, i) => {
    const delay = i * base + Math.random() * jitter
    setTimeout(() => {
      // opacity: quick effects easing (handled in CSS via transition on --reveal)
      el.style.setProperty('--reveal', '1')
      // position: spatial spring with overshoot
      spring(distance, 0, SPRINGS.spatialDefault, (y) => {
        el.style.setProperty('--reveal-y', y.toFixed(2) + 'px')
      })
    }, delay)
  })
}

/**
 * Damped pointer-tracking for the reactive card tilt. Chases a target with a
 * spring so it has inertia (overshoot, then settle) rather than rigid tracking.
 * Returns { set(tx, ty), stop() }.
 */
export function damdamper(onFrame, springCfg = { stiffness: 220, damping: 0.7 }) {
  let tx = 0, ty = 0
  let x = 0, y = 0, vx = 0, vy = 0
  let raf = 0, running = false, prev = 0
  const k = springCfg.stiffness
  const c = springCfg.damping * 2 * Math.sqrt(k)
  const loop = (now) => {
    const dt = Math.min((now - prev) / 1000, 1 / 30)
    prev = now
    const sub = 3, h = dt / sub
    for (let i = 0; i < sub; i++) {
      vx += (-k * (x - tx) - c * vx) * h; x += vx * h
      vy += (-k * (y - ty) - c * vy) * h; y += vy * h
    }
    onFrame(x, y)
    if (Math.abs(x - tx) < 0.001 && Math.abs(vx) < 0.001 &&
        Math.abs(y - ty) < 0.001 && Math.abs(vy) < 0.001) {
      running = false
      return
    }
    raf = requestAnimationFrame(loop)
  }
  return {
    set(nx, ny) {
      tx = nx; ty = ny
      if (!running) { running = true; prev = performance.now(); raf = requestAnimationFrame(loop) }
    },
    stop() { running = false; cancelAnimationFrame(raf) },
  }
}
