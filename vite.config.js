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
      // The Kiez polygons are large + rarely change → precache them (revisioned
      // by content hash) so the app truly works offline and data updates bust
      // the cache on deploy.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,geojson}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
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
