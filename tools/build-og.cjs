// Builds public/og.png (1200×630) — das Vorschaubild fürs Teilen.
//
// Erzählt die zwei Signature-Features visuell: den 1989er MAUERVERLAUF als
// leuchtende Linie quer durch Berlin und die SCHNITZELJAGD als goldene
// POI-Punkte, über der echten Bezirksregionen-Silhouette. Links Wortmarke,
// Headline, Feature-Chips, URL.
//
// Gerendert via Chrome (Playwright, CDP-Capture) aus statischem HTML — die
// echten App-woff2-Fonts + volle CSS-Effekte (Gradient-Text, Glows). resvg
// scheiterte an den VARIABLEN woff2-Fonts; für eine statische Seite ist der
// Chrome-Screenshot zuverlässig (nur der Live-WebGL-Canvas war es nicht).
//
// Usage: node tools/build-og.cjs   (braucht Playwright + Chrome, wie screenshots.cjs)
const fs = require('fs')
const path = require('path')

const PW_PATHS = ['playwright', '/Users/martin/claude/bayoobook/node_modules/playwright']
let chromium = null
for (const p of PW_PATHS) { try { chromium = require(p).chromium; break } catch (e) {} }
if (!chromium) { console.error('playwright not resolvable — adjust PW_PATHS'); process.exit(1) }

const root = path.join(__dirname, '..')
const W = 1200, H = 630
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'public/data', f), 'utf8'))
const bzr = read('bezirksregionen.geojson')
const mauer = read('mauer.geojson')
const pois = read('pois.json').pois

// ── Projektion: Berlin-BBox → Karten-Rechteck (Bleed nach rechts) ────────────
const ringsOf = (g) => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
for (const f of bzr.features) for (const r of ringsOf(f.geometry)) for (const [x, y] of r) {
  if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y
}
const clat = (y1 + y2) / 2, kx = Math.cos(clat * Math.PI / 180)
const BX = 486, BY = -40, BW = 770, BH = 710
const gw = (x2 - x1) * kx, gh = (y2 - y1)
const s = Math.max(BW / gw, BH / gh)
const ox = BX + (BW - gw * s) / 2, oy = BY + (BH - gh * s) / 2
const px = (lon) => ox + (lon - x1) * kx * s
const py = (lat) => oy + (y2 - lat) * s
const pathFor = (geom) => ringsOf(geom).map((r) =>
  'M' + r.map(([lo, la]) => `${px(lo).toFixed(1)} ${py(la).toFixed(1)}`).join('L') + (geom.type.includes('Polygon') ? 'Z' : '')).join('')

const mapPath = bzr.features.map((f) => pathFor(f.geometry)).join('')
const wallPath = mauer.features.filter((f) => f.properties.typ === 'mauer').map((f) => pathFor(f.geometry)).join('')
const GOLD = '#ffc857'
const dots = pois.slice(0, 180)
  .map((p) => ({ x: px(p[3]), y: py(p[4]), r: 2.6 + Math.min(p[7], 60) / 60 * 3.4 }))
  .filter((d) => d.x > BX - 30 && d.x < W + 30 && d.y > -14 && d.y < H + 14)
const dotsSvg = dots.map((d) =>
  `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="${GOLD}" filter="url(#glow)"/>` +
  `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${(d.r * 0.48).toFixed(1)}" fill="#fff6df"/>`).join('')

const font = (file) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'public/fonts', file)).toString('base64')
const fontDisplay = font('space-grotesk-var.woff2')
const fontBody = font('inter-var.woff2')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family:'SG'; src:url(${fontDisplay}) format('woff2'); font-weight:300 700; }
  @font-face { font-family:'IN'; src:url(${fontBody}) format('woff2'); font-weight:100 900; }
  * { margin:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; }
  .og { position:relative; width:${W}px; height:${H}px; overflow:hidden;
    background:radial-gradient(85% 120% at 72% 16%, #16203a 0%, #0b0e14 54%, #07090d 100%);
    font-family:'IN',sans-serif; }
  svg { position:absolute; inset:0; }
  .scrim { position:absolute; inset:0 auto 0 0; width:770px;
    background:linear-gradient(90deg, #07090d 0%, rgba(7,9,13,.86) 50%, rgba(7,9,13,0) 100%); }
  .content { position:absolute; inset:0; padding:64px; }
  .brand { display:flex; align-items:center; gap:16px; }
  .mark { width:52px; height:52px; border-radius:13px; display:grid; place-items:center;
    background:linear-gradient(135deg,#7da2ff,#b69cff); }
  .mark svg { position:static; width:30px; height:30px; }
  .brand b { font-family:'SG'; font-size:34px; font-weight:700; color:#eef2ff; letter-spacing:-.01em; }
  h1 { position:absolute; top:150px; left:64px; font-family:'SG'; font-weight:700; font-size:70px;
    line-height:1.06; letter-spacing:-.02em;
    background:linear-gradient(100deg,#eef2ff 0%,#9db8ff 78%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { position:absolute; top:346px; left:66px; font-size:25px; font-weight:500; color:#aeb8d0; line-height:1.4; }
  .chips { position:absolute; top:462px; left:66px; display:flex; gap:14px; }
  .chip { display:flex; align-items:center; gap:11px; padding:9px 18px 9px 14px; border-radius:20px;
    background:#141a28; border:1px solid #2a3350; font-size:20px; font-weight:600; color:#cdd6ea; }
  .chip i { width:12px; height:12px; border-radius:50%; }
  .url { position:absolute; bottom:60px; left:66px; font-size:22px; font-weight:600; color:#818cab; }
</style></head><body>
  <div class="og">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="mf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7da2ff" stop-opacity=".30"/>
          <stop offset="100%" stop-color="#b69cff" stop-opacity=".15"/>
        </linearGradient>
        <filter id="glow" x="-160%" y="-160%" width="420%" height="420%">
          <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="wg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4.5"/></filter>
      </defs>
      <path d="${mapPath}" fill="url(#mf)"/>
      <path d="${mapPath}" fill="none" stroke="#7da2ff" stroke-opacity=".15" stroke-width="1"/>
      <path d="${wallPath}" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="7" filter="url(#wg)"/>
      <path d="${wallPath}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${dotsSvg}
    </svg>
    <div class="scrim"></div>
    <div class="content">
      <div class="brand">
        <span class="mark"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.4 7-11.3A7 7 0 0 0 5 9.7C5 14.6 12 21 12 21Z" fill="#0b0e14"/><circle cx="12" cy="9.6" r="2.6" fill="#7da2ff"/></svg></span>
        <b>Kiez-Finder</b>
      </div>
    </div>
    <h1>In welchem Kiez<br>stehst du gerade?</h1>
    <div class="sub">Dein Kiez-Pass für Berlin — 542 Kieze,<br>1000 Orte zum Entdecken, die Mauer von 1989.</div>
    <div class="chips">
      <div class="chip"><i style="background:#7da2ff"></i>Standort → Kiez</div>
      <div class="chip"><i style="background:${GOLD}"></i>1000-Orte-Jagd</div>
      <div class="chip"><i style="background:#eef2ff"></i>Mauer 1989</div>
    </div>
    <div class="url">kiezfinder.celox.io</div>
  </div>
</body></html>`

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 }).then((c) => c.newPage())
  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 300))
  const client = await page.context().newCDPSession(page)
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
  fs.writeFileSync(path.join(root, 'public/og.png'), Buffer.from(data, 'base64'))
  await browser.close()
  console.log(`✓ og.png: ${W}×${H} (@2x), ${dots.length} POI-Punkte + Mauerverlauf`)
}
main().catch((e) => { console.error(e); process.exit(1) })
