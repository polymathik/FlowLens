/**
 * Canvas host — one local HTTP server for the canvas SPA + graph API.
 *
 * ```mermaid
 * flowchart LR
 *   B[Browser] -->|"/ , /assets/*"| H[Canvas host :port]
 *   B -->|"/flowlens-api/*"| H
 *   H -->|static| D[(dist/canvas/app)]
 *   H -->|dev only| V[Vite middleware]
 *   H -->|proxy| G[startGraphServer :internal loopback]
 * ```
 *
 * `static` mode needs nothing beyond runtime deps (express). `dev` mode
 * imports Vite (a devDependency) and is only allowed in a source checkout.
 */
import express from 'express';
import http from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { startGraphServer } from '../../canvas/api/graph-server.js';
import {
  CanvasHostError,
  type CanvasHost,
  type CanvasHostOptions,
} from '../../contracts/canvas-host.js';
import { createApiProxy, findFreePort } from './api-proxy.js';
import { locateCanvas, type CanvasLocations } from './package-paths.js';

const API_PREFIX = '/flowlens-api';
const DEFAULT_HOST = '127.0.0.1';

interface UiLayer {
  close: () => Promise<void>;
}

export async function startCanvasHost(
  opts: CanvasHostOptions,
  locations: CanvasLocations = locateCanvas(),
): Promise<CanvasHost> {
  assertModeAvailable(opts.mode, locations);

  const apiPort = opts.apiPort || (await findFreePort());
  const graphServer = await startGraphServer(opts.flowlensDir, apiPort);

  const app = express();
  app.disable('x-powered-by');
  app.use(API_PREFIX, createApiProxy(apiPort));
  const server = http.createServer(app);

  let ui: UiLayer;
  try {
    ui =
      opts.mode === 'dev'
        ? await mountVite(app, server, locations.sourceDir)
        : mountStatic(app, locations.builtDir);
  } catch (err) {
    graphServer.close();
    throw err;
  }

  const host = opts.host ?? DEFAULT_HOST;
  try {
    await listen(server, opts.port, host);
  } catch (err) {
    await ui.close();
    graphServer.close();
    throw err;
  }
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`,
    port,
    mode: opts.mode,
    broadcast: graphServer.broadcast,
    close: async () => {
      await ui.close();
      graphServer.close();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function assertModeAvailable(mode: CanvasHostOptions['mode'], loc: CanvasLocations): void {
  if (mode === 'static' && !loc.builtAvailable) {
    const hint = loc.sourceAvailable
      ? 'Run "npm run build" in the FlowLens checkout, or use "flowlens canvas --dev".'
      : 'This FlowLens installation is missing its canvas bundle; reinstall the package.';
    throw new CanvasHostError(`Canvas bundle not found at ${loc.builtDir}. ${hint}`);
  }
  if (mode === 'dev' && !loc.sourceAvailable) {
    throw new CanvasHostError(
      '--dev requires a FlowLens source checkout (src/canvas not found). Omit --dev to use the built canvas.',
    );
  }
}

/** Serve the pre-built SPA with long-lived caching for hashed assets. */
function mountStatic(app: express.Express, builtDir: string): UiLayer {
  app.use(
    '/assets',
    express.static(join(builtDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
  );
  app.use(express.static(builtDir, { index: 'index.html', maxAge: 0 }));
  // SPA fallback (Express 5 / path-to-regexp v8 wildcard syntax).
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(builtDir, 'index.html'));
  });
  return { close: async () => {} };
}

/** Contributors only: Vite in middleware mode, HMR on the same HTTP server. */
async function mountVite(
  app: express.Express,
  server: http.Server,
  sourceDir: string,
): Promise<UiLayer> {
  let vite: typeof import('vite');
  try {
    vite = await import('vite');
  } catch {
    throw new CanvasHostError('--dev needs Vite installed (run "npm install" in the FlowLens checkout).');
  }
  const devServer = await vite.createServer({
    root: sourceDir,
    configFile: join(sourceDir, 'vite.config.ts'),
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(devServer.middlewares);
  return { close: () => devServer.close() };
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(
        err.code === 'EADDRINUSE'
          ? new CanvasHostError(`Port ${port} is already in use. Pick another with --port.`)
          : err,
      );
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
