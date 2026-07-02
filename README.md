<div align="center">

<img src="docs/og.png" alt="Kiez-Finder — Berlin-Karte mit eingefärbten Kiezen" width="100%"/>

# 🧭 Kiez-Finder

### Dein Kiez-Pass für Berlin — check ein und erfahre sofort, in welchem Kiez du gerade stehst.

[![Live](https://img.shields.io/badge/live-kiezfinder.celox.io-7da2ff?style=for-the-badge&logo=icloud&logoColor=white)](https://kiezfinder.celox.io)
[![PWA](https://img.shields.io/badge/PWA-installierbar-5a3fd6?style=for-the-badge&logo=pwa&logoColor=white)](https://kiezfinder.celox.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-b69cff.svg?style=for-the-badge)](LICENSE)

<!-- status -->
[![Last commit](https://img.shields.io/github/last-commit/pepperonas/kiez-finder?logo=git&logoColor=white)](https://github.com/pepperonas/kiez-finder/commits/main)
[![Commit activity](https://img.shields.io/github/commit-activity/m/pepperonas/kiez-finder)](https://github.com/pepperonas/kiez-finder/commits/main)
[![Repo size](https://img.shields.io/github/repo-size/pepperonas/kiez-finder)](https://github.com/pepperonas/kiez-finder)
[![Top language](https://img.shields.io/github/languages/top/pepperonas/kiez-finder?logo=javascript&logoColor=000)](#tech-stack)
[![Stars](https://img.shields.io/github/stars/pepperonas/kiez-finder?style=flat&logo=github)](https://github.com/pepperonas/kiez-finder/stargazers)

<!-- tech -->
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![MapLibre GL](https://img.shields.io/badge/MapLibre%20GL-4-396CB2?logo=maplibre&logoColor=white)](https://maplibre.org)
[![Material 3](https://img.shields.io/badge/Material%203-Expressive-7da2ff?logo=materialdesign&logoColor=white)](https://m3.material.io)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-f7df1e?logo=javascript&logoColor=000)](#tech-stack)
[![No framework](https://img.shields.io/badge/framework-none-success)](#tech-stack)
[![Self-hosted fonts](https://img.shields.io/badge/fonts-self--hosted-b69cff)](#tech-stack)

<!-- data -->
[![Daten LOR 2021](https://img.shields.io/badge/Daten-LOR%202021-1f9d55)](#datenquellen)
[![Kieze](https://img.shields.io/badge/Kieze-542-1f9d55)](#datenquellen)
[![Bezirke](https://img.shields.io/badge/Bezirke-12-1f9d55)](#datenquellen)
[![Bezirksregionen](https://img.shields.io/badge/Bezirksregionen-143-1f9d55)](#datenquellen)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-Kiez--Namen-7ebc6f?logo=openstreetmap&logoColor=white)](#datenquellen)
[![No API key](https://img.shields.io/badge/API%20key-none-success)](#datenquellen)

<!-- features -->
[![Fuzzy search](https://img.shields.io/badge/Suche-fuzzy-7da2ff)](#features)
[![Offline](https://img.shields.io/badge/offline-ready-5a3fd6)](#features)
[![Sprache](https://img.shields.io/badge/Sprache-Deutsch-e8590c)](#)
[![a11y](https://img.shields.io/badge/a11y-reduced--motion%20·%20Tastatur-blueviolet)](#features)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#mitmachen)

<br/>

<img src="docs/screenshot-mobile.png" alt="Kiez-Finder — Pass-Karte als Bottom-Sheet" width="270"/>
&nbsp;
<img src="docs/screenshot-bezirke.png" alt="Bezirke-Overlay mit Labels" width="48%"/>

<sub><i>Bottom-Sheet auf Mobil · farbige Ebenen-Overlays (Bezirke L · Regionen M · Kieze S)</i></sub>

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

- 🔎 **Fuzzy-Suche** über alle Ebenen (Bezirke · Bezirksregionen · Prognoseräume · Kieze · Planungsräume) — eigener, abhängigkeitsfreier Berlin-getunter Scorer: Umlaut-/ß-/„straße"-Faltung, Präfix→Wort→Substring→Subsequenz→Tippfehler-Tiers, ~0,2 ms/Suche über ~950 Einträge. Treffer wählen → Fläche wird hervorgehoben
- 📍 **Standort → Kiez** über die offiziellen LOR-2021-Planungsräume (542 Kieze), Point-in-Polygon im Browser
- 🗣️ **Umgangssprachlicher Kiez** — der geläufige Kiez-Name (z.B. *Schillerkiez*, *Flughafenkiez*) ist der Titel; der amtliche Planungsraum (z.B. *Wartheplatz*) steht als Unterzeile
- 🧩 **Kiez als EINE Fläche** — ein umgangssprachlicher Kiez besteht oft aus mehreren amtlichen Planungsräumen (Schillerkiez = Hasenheide + Schillerpromenade Nord/Süd + Wartheplatz). Die werden **zusammengeführt** und als eine zusammenhängende Fläche hervorgehoben — präzise, nicht die zu grobe Bezirksregion (355 Kiez-Flächen aus 542 Planungsräumen)
- 🏘️ **Feinkörnige OSM-Kieze** — benannte Kieze, die *kleiner* als ein Planungsraum sind (z.B. *Scheunenviertel*, *Möckernkiez*, *Fischerinsel*), kommen mit ihrer **exakten OSM-Grenze** (71 Polygone) — suchbar, hervorhebbar und beim Drinstehen automatisch erkannt
- 🧅 **Wählbare LOR-Ebenen** — tippe in der Card auf **Kiez · Bezirksregion · Bezirk**, und die zugehörige Fläche wird hervorgehoben (Auto-Zoom auf ihre Ausdehnung)
- 🖱️ **Karte ist anklickbar** — tippe irgendwohin in Berlin, und die Card springt auf den Kiez dieses Punkts (inkl. neuer Adresse)
- 🗺️ **Sektoren-Overlay** (4-Stufen-Button) — *aus · Bezirke (L) · Regionen (M) · Kieze (S)*, von grob nach fein. Färbt die jeweilige Ebene **nachbarschafts-bewusst** (Distanz-2-Graph-Coloring über geteilte Grenzen) → angrenzende **und** nahe Flächen bekommen weit auseinanderliegende Farbtöne und sind klar unterscheidbar. **Jede sichtbare Fläche wird beschriftet** — pro Region ein Label an einem sichtbaren Innenpunkt, beim Zoomen/Verschieben nachgeführt (nicht nur die Fläche, deren Mittelpunkt zufällig im Bild liegt). Zusätzlich benennt eine schwebende **„Aktueller-Bereich"-Plakette** mit Farbpunkt live die Fläche in der Kartenmitte
- 🟦 **Starke Auswahl-Umrandung** — die aktive Auswahl wird mit kräftiger heller Linie + dunklem Casing-Halo gezeichnet, damit sie auch über dem dichten Farb-Overlay klar heraussticht
- 🏷️ **Eigene Label-Ebene** — Bezirke groß/hell (schon bei weitem Zoom), Bezirksregionen kleiner; MapLibre-Kollision zeigt immer die im Ausschnitt passenden Labels (Basemap-Ortsteil-Labels werden ausgeblendet, damit die offizielle Hierarchie dominiert)
- 🗺️🗣️ **Umgangssprachliche Kiez-Namen auf der Karte** — 537 OSM-Kieze (`place=quarter`/`neighbourhood`, z.B. Flughafenkiez, Reuterkiez, Sprengelkiez) als akzentfarbene Labels bei höherem Zoom
- 🗺️ **Lebendige Vektorkarte** (MapLibre GL) mit `flyTo`-Lock-on und sich selbst zeichnender Kiez-Grenze
- 🎨 **Material 3 Expressive** — Feder-Physik statt Easing-Fades, tonale Flächen, XL-Shapes, Shape-Morph beim Tippen
- 🌗 **Hell/Dunkel** mit kreisförmigem View-Transition-Reveal (dark-matter ↔ positron)
- 📱 **PWA + Mobile** — installierbar, **echt offline-fähig**: alle 10 Geojson-Datensätze (~1,3 MB — Kieze, Bezirke, Regionen, Labels …) werden vom Service Worker **revisioniert precached** — einmal besucht, klassifiziert die App auch ohne Netz, und Daten-Updates busten den Cache automatisch beim Deploy. Schlägt der Kern-Datensatz beim allerersten Laden fehl (offline/404), zeigt die App eine ehrliche **„Daten nicht geladen"-Card mit Retry** statt fälschlich „nicht in Berlin". Die Card ist auf Mobilgeräten ein **MD3-Bottom-Sheet** mit echten **Swipe-Gesten**: vom 44-px-Griff oder der ganzen Karte hoch-/runterziehen, **Pull-down vom Listenanfang** zum Einklappen, **Tap aufs eingeklappte Sheet** zum Öffnen; geschwindigkeits- + positionsbasiertes Snapping (leichter Flick genügt), Scroll-vs-Drag korrekt getrennt, nicht-modal über der Karte, Safe-Area-Insets, `dvh`-Höhe. Auf **Desktop** lässt sich das Info-Panel ein- und ausklappen (Pfeil-Button → schiebt es zur Seite, Reopen-Tab holt es zurück; Zustand wird gemerkt)
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

# 4) aggregierte Ebenen für die Highlight-Auswahl (aus den Kiezen dissolved,
#    genestet über die plr_id-Präfixe: Bezirk 2 ⊃ Prognoseraum 4 ⊃ Bezirksregion 6 ⊃ Kiez 8)
npx mapshaper public/data/kieze.geojson -each 'id=plr_id.substring(0,2)' -dissolve id copy-fields=bez                -o public/data/bezirke.geojson precision=0.0001
npx mapshaper public/data/kieze.geojson -each 'id=plr_id.substring(0,4)' -dissolve id copy-fields=pgr_name,bez       -o public/data/prognoseraeume.geojson precision=0.00001
npx mapshaper public/data/kieze.geojson -each 'id=plr_id.substring(0,6)' -dissolve id copy-fields=bzr_name,bez       -o public/data/bezirksregionen.geojson precision=0.00001

# 5) zusammengeführte „Kiez-Flächen" (umgangssprachliche Kieze):
#    jeder Planungsraum wird per Reverse-Geocoding (Nominatim, quarter/neighbourhood)
#    seinem umgangssprachlichen Kiez zugeordnet, dann nach Kiez-Name + zusammenhängender
#    Komponente gruppiert (shared-vertex Adjazenz) und per `-dissolve gid` verschmolzen.
#    Ergebnis: kieze.geojson bekommt gid+kiez je Planungsraum, kiez-areas.geojson = eine
#    Fläche je Kiez (355 aus 542). Quarter ist nicht flächendeckend → ~78 % Abdeckung,
#    der Rest bleibt sein eigener Planungsraum. (Build-Skripte: siehe git-Historie /
#    `/tmp/rev-all.mjs` + `/tmp/build-kiez-areas.mjs`.)

# 6) OSM-Kiez-Namen (Punkt-Labels) via Overpass → kiez-names.geojson
#    node-Query: place=quarter|neighbourhood in Berlin → 537 Punkte
```

## Deploy

Statischer Build → `rsync` auf den celox.io-VPS, TLS via Let's Encrypt (certbot). Die Nginx-Config
muss `Permissions-Policy: geolocation=(self)` auf dem HTML-Dokument setzen (sonst blockt der Browser
die Standortabfrage):

```bash
npm run build
rsync -avz --delete dist/ root@<vps>:/var/www/kiezfinder.celox.io/
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
