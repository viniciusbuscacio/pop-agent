import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * The build writes to web/dist, which the Hono server serves directly. There
 * is no Vite dev server: Popy runs on one port (8787, fronted by HTTPS), and
 * `vite build --watch` keeps that true while developing -- what gets tested is
 * exactly what production serves.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
