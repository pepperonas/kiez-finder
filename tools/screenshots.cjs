// Regenerates the README screenshots (docs/screenshot-*.png).
//
// Usage:
//   npm run build && npm run preview -- --port 4190   # in one terminal
//   node tools/screenshots.cjs                        # in another
//
// Needs the `playwright` npm package resolvable (any install — see PW_PATHS)
// and Google Chrome (channel: 'chrome'; bundled browsers not required).
// Screenshots are captured via CDP Page.captureScreenshot — Playwright's own
// page.screenshot() waits for render stability and hangs on the continuously
// repainting MapLibre WebGL canvas under software rendering.
//
// Geolocation is mocked to the Reuterkiez (Neukölln) so the found card shows
// real data. The four app shots use the dark theme (the app default, matches
// docs/og.png); the Mauer shot deliberately uses the LIGHT theme — its
// paper-toned retro look reads far more "archival print" than the dark ink
// variant. Afterwards: `pngquant --quality=70-90 --force --output f f` per file.
const fs = require('fs')

const PW_PATHS = ['playwright', '/Users/martin/claude/bayoobook/node_modules/playwright']
let chromium = null
for (const p of PW_PATHS) { try { chromium = require(p).chromium; break } catch (e) {} }
if (!chromium) { console.error('playwright not resolvable — adjust PW_PATHS'); process.exit(1) }

const BASE = process.env.KF_BASE || 'http://localhost:4190/'
const OUT = __dirname + '/../docs'
// Reuterkiez, Neukölln — a real colloquial Kiez with a merged area
const GEO = { latitude: 52.4886, longitude: 13.4283 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpShot(page, path) {
  const client = await page.context().newCDPSession(page)
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path, Buffer.from(data, 'base64'))
  console.log('wrote', path, Math.round(fs.statSync(path).size / 1024) + 'K')
}

const ctxOpts = (extra) => ({
  deviceScaleFactor: 2, geolocation: GEO, permissions: ['geolocation'],
  locale: 'de-DE', ...extra,
})

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  // ── mobile (dark): found card as bottom sheet after the geolocation lock-on ─
  {
    const ctx = await browser.newContext(ctxOpts({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' }))
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.evaluate(() => document.fonts.ready)
    await sleep(16000) // lock-on flight + tiles + boundary reveal
    await cdpShot(page, OUT + '/screenshot-mobile.png')
    await ctx.close()
  }

  // ── desktop sequence (dark): found → Bezirke overlay → Kieze overlay ───────
  {
    const ctx = await browser.newContext(ctxOpts({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }))
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.evaluate(() => document.fonts.ready)
    await sleep(16000)
    await cdpShot(page, OUT + '/screenshot-desktop.png') // found card + drawn boundary

    // zoom out to city overview, then Bezirke overlay
    await page.mouse.move(880, 450)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 400); await sleep(350) }
    await sleep(3000)
    await page.click('.seg-btn') // off → bezirke
    await sleep(9000)
    await cdpShot(page, OUT + '/screenshot-bezirke.png')

    // Kieze overlay (S): the colourful colloquial-Kiez patchwork
    await page.click('.seg-btn') // → bzr
    await sleep(1500)
    await page.click('.seg-btn') // → kiez
    await sleep(9000)
    await cdpShot(page, OUT + '/screenshot-kieze.png')
    await ctx.close()
  }

  // ── Mauer mode (LIGHT — the paper look): retro map + sector stamp ──────────
  {
    const ctx = await browser.newContext(ctxOpts({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' }))
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.evaluate(() => document.fonts.ready)
    await sleep(16000)
    await page.mouse.move(880, 450)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 400); await sleep(350) }
    await sleep(3000)
    await page.click('.wall-btn')
    await sleep(12000) // wall data (lazy) + hatch + spot colours
    await cdpShot(page, OUT + '/screenshot-mauer.png')
    await ctx.close()
  }

  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
