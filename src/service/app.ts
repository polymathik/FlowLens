/**
 * createServiceApp — the daemon's Express app. Everything under `/api`
 * requires the bearer token and a loopback Host header. The explorer
 * (wave 2) can mount UI routes on the returned app before it listens and
 * reuse `requireAuth` for its own API routes.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { MountRoutes, ServiceDeps } from '../contracts/service-deps.js';
import { GRAPH_RPC_PROTOCOL, type PingResponse } from '../contracts/service.js';
import { authenticate } from './auth.js';
import { OWN_PROTOCOL_KEY } from './daemon-info.js';
import { authenticateBrowser } from './browser-auth.js';
import { errorBody, ServiceError, toServiceError } from './errors.js';
import { mountGraphRoutes } from './routes-graph.js';
import { mountProjectRoutes } from './routes-projects.js';
import { mountReindexRoute } from './routes-reindex.js';
import { zonesBodyParser } from './routes-zones.js';
import { ZONES_ROUTE } from '../contracts/zones.js';

export type { MountRoutes, ServiceDeps } from '../contracts/service-deps.js';

export function requireAuth(deps: Pick<ServiceDeps, 'token' | 'onActivity' | 'sessions' | 'port'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let denied = authenticate(deps.token, req.headers, req.originalUrl, req.method);
    if (denied?.code === 'unauthorized') {
      const path = req.originalUrl.split('?')[0];
      denied = authenticateBrowser(deps.sessions, deps.port, req.method, path, req.headers);
      if (!denied) res.locals.authVia = 'cookie';
    } else if (!denied) {
      res.locals.authVia = 'bearer';
    }
    if (denied) {
      res.status(denied.status).json(errorBody(denied.code, denied.message));
      return;
    }
    deps.onActivity?.();
    next();
  };
}

export function createServiceApp(deps: ServiceDeps, mount?: MountRoutes): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', requireAuth(deps));
  app.use(ZONES_ROUTE, zonesBodyParser()); // 256 KB cap for this route, before the daemon-wide parser
  app.use('/api', express.json({ limit: '512mb' }));

  app.get('/api/ping', (_req, res) => {
    const pong: PingResponse = {
      ok: true, pid: process.pid, version: deps.version, uptime_ms: Date.now() - deps.startedAt, protocol: GRAPH_RPC_PROTOCOL,
      protocol_key: OWN_PROTOCOL_KEY,
    };
    res.json(pong);
  });
  app.get('/api/version', (_req, res) => {
    res.json({ ok: true, version: deps.version, api_version: 1 });
  });
  app.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true });
    res.on('finish', () => deps.onShutdown());
  });

  mountProjectRoutes(app, deps);
  mountGraphRoutes(app, deps);
  mountReindexRoute(app, deps);
  mount?.(app, deps);

  app.use('/api', (_req, res) => {
    res.status(404).json(errorBody('not_found', 'Unknown route'));
  });
  // Express error handler (4 args). Body-parser errors carry `status`.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status;
    if (!(err instanceof ServiceError) && status && status >= 400 && status < 500) {
      res.status(status).json(errorBody('bad_request', (err as Error).message));
      return;
    }
    const se = toServiceError(err);
    deps.log(`[error] ${se.code}: ${se.message}`);
    res.status(se.status).json(errorBody(se.code, se.message));
  });
  return app;
}
