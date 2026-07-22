import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Kiez-Finder — deployed at the root of kiezfinder.celox.io
export default defineConfig({
  base: '/',
  build: {
    target: 'es2020',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'favicon.svg', 'og.png'],
      // The Kiez polygons + street index are large + rarely change → precache
      // them (revisioned by content hash) so the app truly works offline and
      // data updates bust the cache on deploy.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,geojson,json}'],
        // Anreicherungs-Daten (POI-Infos/-Bilder, Kiez-Fotos) werden HÄUFIG
        // aktualisiert und NICHT precached, sondern NetworkFirst geladen (s. u.).
        // Precache aktualisiert nur beim SW-Shell-Update — ein Client mit noch
        // altem JS bekam dadurch dauerhaft veraltete Daten (fehlende/getauschte
        // Fotos). NetworkFirst = online immer frisch, offline Fallback auf Cache.
        // Zusätzlich der three.js-Chunk: er wird NUR dynamisch geladen (3D-Ebene,
        // nur bei WebGL + ohne reduced-motion). Aus dem Precache raus → reduced-
        // motion/no-WebGL-Nutzer laden ihn nie; wer ihn braucht, holt ihn per
        // dynamischem Import und cached ihn dann CacheFirst (s. u.).
        globIgnores: ['**/poi-info.json', '**/kiez-img.json', '**/three*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        // /api/* sind ECHTE Server-Routen (OAuth-Redirects sind Navigationen!) —
        // ohne diese Ausnahme liefert der SW dafür index.html aus und der Login
        // bricht wortlos ab.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // three.js-Chunk (3D-Ebene): dynamisch importiert, content-gehasht →
            // unveränderlich → CacheFirst. Erst beim ersten Bedarf geladen, dann
            // offline + instant. Nicht im Precache (s. globIgnores).
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/three[.-].*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'kf-three',
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Anreicherungs-Daten: NetworkFirst → immer frisch, wenn online;
            // offline aus dem Cache. Entkoppelt Daten-Updates vom SW-Shell-Zyklus.
            urlPattern: ({ url }) => url.origin === self.location.origin &&
              (url.pathname === '/data/poi-info.json' || url.pathname === '/data/kiez-img.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kf-enrich',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Selbst gehostete POI-Fotos: zu groß fürs Precache (~22 MB), aber
            // pro qid unveränderlich → CacheFirst. Einmal angeschaut = offline
            // + instant beim Wiederbesuch. maxEntries deckelt das Wachstum.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/img/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'poi-images', // POI- + Kiez-Fotos
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[a-d]?\.?basemaps\.cartocdn\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'carto-basemap',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nominatim',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Kiez-Finder · Berlin',
        short_name: 'Kiez-Finder',
        description: 'Dein Kiez-Pass für Berlin — finde heraus, in welchem Kiez du gerade stehst.',
        lang: 'de',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['navigation', 'travel', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // dedicated maskable: full-bleed bg + pin inside the 80% safe zone,
          // so Android's circle/squircle mask never clips the artwork
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
