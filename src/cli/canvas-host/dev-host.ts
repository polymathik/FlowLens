/**
 * Contributor dev host for `flowlens canvas --dev`: Vite in middleware mode
 * (HMR on the same HTTP server) for `src/canvas`, with `/api/*` and `/auth`
 * proxied to the daemon. Source checkout only (Vite is a devDependency).
 */
import express from 'express';
import http from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { CanvasHostError } from '../../contracts/canvas-host.js';
import type { DevHost, DevHostOptions } from '../../contracts/canvas/explorer.js';
import { createApiProxy } from './api-proxy.js';
import { locateCanvas, type CanvasLocations } from './package-paths.js';

const HOST = '127.0.0.1';

export async function startDevHost(opts: DevHostOptions, locations: CanvasLocations = locateCanvas()): Promise<DevHost> {
  if (!locations.sourceAvailable) {
    throw new CanvasHostError('--dev requires a FlowLens source checkout (src/canvas not found). Omit --dev to use the built explorer.');
  }
  let vite: typeof import('vite');
  try {
    vite = await import('vite');
  } catch {
    throw new CanvasHostError('--dev needs Vite installed (run "npm install" in the FlowLens checkout).');
  }
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  await listen(server, opts.port);
  const port = (server.address() as AddressInfo).port;
  const origin = `http://${HOST}:${port}`;
  const proxy = createApiProxy(opts.daemonPort, { fromOrigin: origin });
  app.use('/api', proxy);
  app.use('/auth', proxy);

  const devServer = await vite.createServer({
    root: locations.sourceDir,
    configFile: join(locations.sourceDir, 'vite.config.ts'),
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(devServer.middlewares);
  return {
    origin,
    port,
    close: async () => {
      await devServer.close();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' ? new CanvasHostError(`Port ${port} is already in use. Pick another with --port.`) : err);
    };
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}
