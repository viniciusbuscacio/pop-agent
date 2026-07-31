import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The build writes to web/dist, which the Hono server serves directly. There
 * is no Vite dev server: Popy runs on one port (8787, fronted by HTTPS), and
 * `vite build --watch` keeps that true while developing -- what gets tested is
 * exactly what production serves.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a silently updated PWA keeps serving the
      // previous build until it is next opened cold, which on a phone can be
      // days and reads as an app that stopped being fixed.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Popy',
        short_name: 'Popy',
        description: 'Your own agent, on your own server.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // Matches the dark token surface, so the iOS status bar and the
        // Android splash do not flash a colour the app never uses.
        theme_color: '#202020',
        background_color: '#202020',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // The API and the SSE stream are never served from the cache, and a
        // navigation must never be answered with the shell in their place.
        navigateFallbackDenylist: [/^\/v1\//, /^\/healthz$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/v1/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
