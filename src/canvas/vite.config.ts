/**
 * Vite config for the FlowLens canvas SPA.
 *
 * Paths are resolved from this file's location (never from `process.cwd()`)
 * so `vite build --config src/canvas/vite.config.ts` works from any
 * directory. The production bundle lands in `dist/canvas/app/` — a
 * dedicated sub-folder so `emptyOutDir` never wipes the tsc output of
 * `src/canvas/api/graph-server.ts` (emitted to `dist/canvas/api/`), and so
 * the static server only ever exposes the bundle.
 *
 * Vendor libraries are split into stable, cacheable chunks. ELK is a single
 * ~1.4 MB pre-bundled module (GWT output) that cannot be split further; it
 * is isolated in its own chunk and the warning limit is raised to cover it.
 * Lazy-loading ELK (dynamic import / web worker) is a canvas-code change
 * owned by the canvas lane.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const canvasRoot = fileURLToPath(new URL('.', import.meta.url));

/** Map a module id to a vendor chunk name (undefined = let Rollup decide). */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('/elkjs/')) return 'vendor-elk';
  if (id.includes('/@xyflow/')) return 'vendor-xyflow';
  if (/\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
  if (/\/d3-[a-z-]+\//.test(id)) return 'vendor-d3';
  return 'vendor';
}

export default defineConfig({
  plugins: [react()],
  root: canvasRoot,
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/flowlens-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(canvasRoot, '../../dist/canvas/app'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
});
