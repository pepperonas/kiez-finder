# Vendored amtliche Quelldaten (Build-Inputs für `tools/build-stats.mjs`)

## EWR_L21_202512E_Matrix.csv

**Einwohnerregisterstatistik Berlin, Stand 31.12.2025**, je LOR-2021-Planungsraum
(Spalte `RAUMID` = `plr_id`, `E_E` = Einwohner insgesamt; SAFE-anonymisiert, 2 PLRs = `NA`:
Pankower Tor, Landweg — praktisch unbewohnt).

- **Urheber/Lizenz:** Amt für Statistik Berlin-Brandenburg, CC BY 3.0 DE
  (Datensatzreihe „Einwohnerinnen und Einwohner in Berlin in LOR-Planungsräumen",
  daten.berlin.de). Die Original-Download-URLs (`…/opendata/EWR_L21_*_Matrix.csv`)
  sind seit dem Website-Relaunch des Amts tot (CMS-Catch-all statt Datei, auch in
  der Wayback Machine nur die HTML-Shell) — diese Kopie stammt aus dem Mirror
  `github.com/dhelweg/gentriduck` (`ingestion/berlin/ewr/vendored/`).
- **Verifikation der Kopie (2026-07-19):** 542/542 `RAUMID`s decken sich exakt mit
  den `plr_id`s unserer amtlichen LOR-2021-Geometrie (`public/data/kieze.geojson`,
  direkt vom Geoportal-WFS); Berlin-Summe **3.913.644** Einwohner — konsistent mit
  der amtlichen Einwohnerregisterstatistik zum 31.12.2025 (SB A I 5 – hj 2/25).

## lor-flaechen.json

**Amtliche Flächeninhalte** (m², Attribut `finhalt`) je Planungsraum, einmalig vom
Geoportal-WFS `gdi.berlin.de/services/wfs/lor_2021` gezogen (2026-07-19).
Kontrollsumme: 891,1 km² (amtliche Landesfläche 891,7 km² — Differenz = LOR-Zuschnitt).
