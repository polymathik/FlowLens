/**
 * Standalone graph API server for one project (routes under /flowlens-api).
 * Kept for tests and embedders; the CLI serves the canvas through the
 * daemon (`/api/projects/:id/canvas/*`, see `createGraphApp`).
 * Binds 127.0.0.1 only and sends no CORS headers.
 */
import express from 'express';
import { join, dirname } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { createGraphApp } from './graph-app.js';

/**
 * Handle returned by startGraphServer. `broadcast` pushes a named event to
 * every connected SSE client.
 */
export interface GraphServer {
  close: () => void;
  broadcast: (type: string, payload: unknown) => void;
  /** Port actually bound (useful when 0 was requested). */
  port: number;
}

export async function startGraphServer(flowlensDir: string, port = 3001): Promise<GraphServer> {
  const graphStore = new LevelGraphStore();
  await graphStore.open(join(flowlensDir, 'graph'));
  const graphApp = createGraphApp({ graph: graphStore, rootDir: dirname(flowlensDir), flowlensDir });
  const app = express();
  app.disable('x-powered-by');
  app.use('/flowlens-api', graphApp.router);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        close: () => {
          graphApp.closeEvents();
          server.close();
          void graphStore.close();
        },
        broadcast: graphApp.broadcast,
      });
    });
    server.on('error', async (err) => {
      await graphStore.close();
      reject(err);
    });
  });
}
