import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The overlay is served by the harness from web/dist. In development (`npm run web:dev`), Vite serves it
// with hot reload and proxies the live stream to a running harness on :8787.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
