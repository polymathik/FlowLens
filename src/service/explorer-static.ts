/**
 * Serves the built explorer SPA (`dist/canvas/app`) from the daemon at `/`.
 *
 * The bundle holds no secrets, so it is served without a session (the SPA
 * asks `/api/session` and explains how to sign in). Still: loopback Host
 * only, a strict CSP, no framing, nosniff. Hashed `/assets/*` are immutable;
 * `index.html` is `no-cache`; unknown non-API paths fall back to it.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { join } from 'node:path';
import { locateCanvas, type CanvasLocations } from '../cli/canvas-host/package-paths.js';
import { isLoopbackHost } from './auth.js';

/** Inline style attributes are used by React components; scripts are same-origin only. */
export const EXPLORER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const NOT_BUILT = (dir: string, source: boolean) => `<!doctype html><meta charset="utf-8"><title>FlowLens</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 16px">
<h1>The explorer UI is not built</h1><p>Expected it at <code>${dir.replace(/[<>&]/g, '')}</code>.</p>
<p>${source ? 'In the FlowLens checkout run <code>npm run build</code>, or use <code>flowlens canvas --dev</code>.' : 'Reinstall FlowLens; the package is missing its UI bundle.'}</p>`;

function securityHeaders(res: Response): void {
  res.set({
    'Content-Security-Policy': EXPLORER_CSP,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

export function mountExplorerStatic(app: Express, locations?: CanvasLocations): void {
  let loc: CanvasLocations | null = null;
  try {
    loc = locations ?? locateCanvas();
  } catch {
    loc = null;
  }
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path === '/api') return next();
    if (!isLoopbackHost(req.headers)) {
      res.status(403).type('text/plain').send('Host not allowed');
      return;
    }
    securityHeaders(res);
    next();
  };
  app.use(guard);

  if (!loc?.builtAvailable) {
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.status(503).type('html').send(NOT_BUILT(loc?.builtDir ?? 'dist/canvas/app', Boolean(loc?.sourceAvailable)));
    });
    return;
  }
  const builtDir = loc.builtDir;
  app.use('/assets', express.static(join(builtDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(builtDir, { index: 'index.html', maxAge: 0 }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/api') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(builtDir, 'index.html'));
  });
}
