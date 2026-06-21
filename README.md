<div align="center">

# 🧭 Kiez-Finder

### Dein Kiez-Pass für Berlin — check ein und erfahre sofort, in welchem Kiez du gerade stehst.

[![Live](https://img.shields.io/badge/live-kiez--finder.celox.io-7da2ff?style=for-the-badge&logo=icloud&logoColor=white)](https://kiez-finder.celox.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-b69cff.svg?style=for-the-badge)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installierbar-5a3fd6?style=for-the-badge&logo=pwa&logoColor=white)](https://kiez-finder.celox.io)

[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![MapLibre GL](https://img.shields.io/badge/MapLibre%20GL-4-396CB2?logo=maplibre&logoColor=white)](https://maplibre.org)
[![Material 3](https://img.shields.io/badge/Material%203-Expressive-7da2ff?logo=materialdesign&logoColor=white)](https://m3.material.io)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-f7df1e?logo=javascript&logoColor=000)](#)
[![No API key](https://img.shields.io/badge/API%20key-none-success)](#datenquellen)
[![Daten](https://img.shields.io/badge/Daten-LOR%202021%20·%20542%20Kieze-1f9d55)](#datenquellen)
[![Berlin](https://img.shields.io/badge/Berlin-12%20Bezirke-e8590c)](#)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#mitmachen)

<br/>

<img src="docs/screenshot-mobile.png" alt="Kiez-Finder — Pass-Karte über der Karte" width="300"/>

</div>

---

## Was ist das?

Berlin ist keine Stadt, sondern ein Haufen Kieze. **Kiez-Finder** bestimmt per Geolocation,
in welchem der **542 offiziellen Berliner Planungsräume (LOR 2021)** du gerade stehst,
zeichnet die Grenze deines Kiezes auf die Karte und zeigt dir die volle Hierarchie:

> **Kiez** → Bezirksregion → Prognoseraum → **Bezirk**, dazu die genaue Adresse und Koordinaten.

Die Klassifizierung läuft gegen die **amtlichen Kiez-Grenzen** (Point-in-Polygon im Browser) —
nicht gegen ungenaues Reverse-Geocoding. Stehst du außerhalb der Stadtgrenze, sagt der Pass dir das auch.

## Das Konzept: ein Kiez-Pass

Eine einzige Idee, durch jede Schicht gezogen: *Du checkst an deinem Standort ein, und die Stadt
verrät dir, welcher Kiez dich gerade beherbergt.* Die Sprache („einchecken"), die Karte (eine
gestempelte Pass-Karte), der **Signature-Moment** (Lock-on: die Kamera fliegt zu dir, dann zeichnet
sich deine Kiez-Grenze selbst ein) und der Leerzustand („außerhalb der Stadtgrenze gilt der Pass nicht")
gehorchen alle diesem einen Satz.

## Features

- 📍 **Standort → Kiez** über die offiziellen LOR-2021-Planungsräume (542 Kieze), Point-in-Polygon im Browser
- 🗺️ **Lebendige Vektorkarte** (MapLibre GL) mit `flyTo`-Lock-on und sich selbst zeichnender Kiez-Grenze
- 🎨 **Material 3 Expressive** — Feder-Physik statt Easing-Fades, tonale Flächen, XL-Shapes, Shape-Morph beim Tippen
- 🌗 **Hell/Dunkel** mit kreisförmigem View-Transition-Reveal (dark-matter ↔ positron)
- 📱 **PWA** — installierbar, offline-fähig (Kiez-Grenzen & Karten werden gecacht)
- ♿ **Robust** — Progressive Enhancement, `prefers-reduced-motion`, sichtbarer Fokus, Tastatur (`R` = neu einchecken), Touch-Targets ≥ 44 px
- 🔑 **Kein API-Key** — keyless Carto-Tiles + Nominatim, keine Secrets im Code

## Tech-Stack

| Schicht | Wahl | Warum |
|---|---|---|
| Build | **Vite 6** | Eine kleine JS-Insel, gehashte Assets, PWA-Plugin |
| Karte | **MapLibre GL JS 4** | Vektor-Tiles, weiche `flyTo`-Physik, Polygon-Layer |
| Tiles | **CARTO dark-matter / positron** | keyless, kostenlos, dunkel |
| Geocoding | **Nominatim (OSM)** | nur für die Adresszeile (gecacht, 1 req/s-Policy) |
| Motion | eigener **MD3-Feder-Integrator** | echte Spring-Physik (`stiffness`/`damping`), nicht CSS-Fades |
| Fonts | **Space Grotesk + Inter** (variable, self-hosted) | Display vs. Body, keine externen Requests |
| UI | **Vanilla JS** | maximal klein, volle Kontrolle über jeden Frame |

## Motion-System

CSS kennt keine Federn — deshalb fährt die räumliche Bewegung (Position/Größe/Reveal, mit Overshoot)
über einen winzigen semi-impliziten Euler-Spring-Integrator (`src/motion.js`). Die Konstanten sind die
**M3-*Expressive*-Tokens** wörtlich:

| Spring | stiffness | damping | Einsatz |
|---|---|---|---|
| spatial-fast | 800 | 0.6 | Signatur-Bounce |
| spatial-default | 380 | 0.8 | Karten-/Listen-Reveal |
| spatial-slow | 200 | 0.8 | Kiez-Grenze zeichnet sich ein |

Opazität & Farbe („effects") bleiben auf MD3-Easing (`cubic-bezier(0.2,0,0,1)`) — ein überschwingender
Fade sieht kaputt aus. Ein Timing-System, überall wiederverwendet.

## Lokal entwickeln

```bash
npm install
npm run dev       # Vite-Dev-Server (HTTPS nötig für Geolocation → siehe Hinweis)
npm run build     # Production-Build nach dist/
npm run preview   # Build lokal testen
```

> **Hinweis:** Geolocation braucht einen *secure context*. `localhost` gilt als sicher; auf anderen
> Hosts muss HTTPS aktiv sein.

### Kiez-Daten neu erzeugen

Die Grenzen liegen vorverarbeitet unter `public/data/`. Neu aus der amtlichen Quelle bauen:

```bash
# 1) LOR-2021-Planungsräume (WGS84) vom Geoportal Berlin
curl "https://gdi.berlin.de/services/wfs/lor_2021?service=WFS&version=2.0.0&request=GetFeature&typeNames=lor_2021:a_lor_plr_2021&outputFormat=application/json&srsName=EPSG:4326" -o plr.geojson

# 2) auf die nötigen Felder reduzieren + vereinfachen (~628 KB)
npx mapshaper plr.geojson -filter-fields plr_id,plr_name,bzr_name,pgr_name,bez \
  -simplify 12% keep-shapes planar -clean -o public/data/kieze.geojson precision=0.00001

# 3) Stadtgrenze für den Übersichts-Zustand
npx mapshaper public/data/kieze.geojson -dissolve -o public/data/berlin-outline.geojson precision=0.0001
```

## Deploy

Statischer Build → `rsync` auf den celox.io-VPS, TLS via Let's Encrypt (certbot). Die Nginx-Config
muss `Permissions-Policy: geolocation=(self)` auf dem HTML-Dokument setzen (sonst blockt der Browser
die Standortabfrage):

```bash
npm run build
rsync -avz --delete dist/ root@<vps>:/var/www/kiez-finder.celox.io/
```

## Datenquellen

- **Kiez-Grenzen:** LOR 2021 Planungsräume — *Geoportal Berlin / Amt für Statistik Berlin-Brandenburg* (CC-BY-3.0 DE)
- **Karten:** © OpenStreetMap-Mitwirkende, © CARTO
- **Adresse:** Nominatim / OpenStreetMap

## Mitmachen

Issues und PRs willkommen. Die App ist bewusst klein und abhängigkeitsarm — bitte halte sie so.

## Lizenz

[MIT](LICENSE) © [pepperonas](https://github.com/pepperonas)

<div align="center"><sub>Made with ❤️ in Berlin · <a href="https://celox.io">celox.io</a></sub></div>
