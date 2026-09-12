import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { navigationFallbackDenylist } from './pwa-navigation';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const popAgentVersion = readFileSync(join(root, 'VERSION'), 'utf8').trim();

/**
 * The build writes to web/dist, which the Hono server serves directly. There
 * is no Vite dev server: Pop Agent runs on one port (8787, fronted by HTTPS), and
 * `vite build --watch` keeps that true while developing -- what gets tested is
 * exactly what production serves.
 */
export default defineConfig({
  // This is compiled into the PWA bundle. Settings must report the version
  // loaded on this device, not ask the server and accidentally report its version.
  define: {
    __POP_AGENT_VERSION__: JSON.stringify(popAgentVersion),
  },
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
        name: 'Pop Agent',
        short_name: 'Pop Agent',
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
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // The freshly activated worker must claim the open page, or the
        // `controllerchange` the Reload button waits on never fires and the
        // reload races activation (the press-Reload-twice bug). Safe under
        // 'prompt': activation itself still waits for the user's consent.
        clientsClaim: true,
        // Adds the Web Push handlers (docs/specs/Spec-Pop-General.md §14) to the generated worker.
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        // Keep APIs, signed file views and public installer/download routes
        // on the network. Both the installer redirect and its immutable target
        // must bypass the shell, or a PWA click navigates home instead of downloading.
        navigateFallbackDenylist: navigationFallbackDenylist,
        // API requests pass directly to fetch. The client owns deadlines and
        // reconnect recovery; Workbox must not wrap network failures.

      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
