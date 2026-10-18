/**
 * Explorer sign-in routes:
 *
 *   POST /api/auth/code   bearer only → AuthCodeResponse (single-use, 15 s by default)
 *   GET  /auth?t=<code>   sets the session cookie, 303 → /#<redirect>
 *   GET  /api/session     SessionResponse (cookie or bearer)
 *
 * The code travels in the URL the CLI opens, so `/auth` answers with
 * `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, consumes the
 * code on first use and redirects at once (the code never stays in the
 * address bar or history entry of the explorer page).
 */
import type { Express } from 'express';
import {
  AUTH_CODE_MAX_TTL_MS, EXPLORER_ROUTES, type AuthCodeRequest, type AuthCodeResponse, type SessionResponse,
} from '../contracts/canvas/explorer.js';
import type { ServiceDeps } from './app.js';
import { isLoopbackHost } from './auth.js';
import { errorBody } from './errors.js';
import { SessionStore } from './sessions.js';

const SIGN_IN_FAILED = `<!doctype html><meta charset="utf-8"><title>FlowLens — sign in</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px;color:#1f2937}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px}@media(prefers-color-scheme:dark){body{background:#0f141b;color:#e5e7eb}code{background:#1f2937}}</style>
<h1>This sign-in link has expired</h1>
<p>Links from <code>flowlens canvas</code> work once and only for a few seconds.
Run <code>flowlens canvas</code> again in your project folder to open the explorer.</p>`;

function clampTtl(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(AUTH_CODE_MAX_TTL_MS, Math.max(1_000, Math.round(raw)));
}

export function mountExplorerAuth(app: Express, deps: ServiceDeps, sessions: SessionStore): void {
  app.post(EXPLORER_ROUTES.authCode, (req, res) => {
    if (res.locals.authVia !== 'bearer') {
      res.status(401).json(errorBody('unauthorized', 'Minting a sign-in code needs the CLI token'));
      return;
    }
    const body = (req.body ?? {}) as AuthCodeRequest;
    const ttl = clampTtl(body.ttl_ms, sessions.defaultCodeTtlMs);
    const code = sessions.mintCode(body.redirect, ttl);
    const out: AuthCodeResponse = {
      ok: true,
      code,
      url: `http://127.0.0.1:${deps.port}${EXPLORER_ROUTES.auth}?t=${encodeURIComponent(code)}`,
      expires_in_ms: ttl,
    };
    res.json(out);
  });

  app.get(EXPLORER_ROUTES.session, (_req, res) => {
    const out: SessionResponse = { ok: true, via: res.locals.authVia === 'bearer' ? 'bearer' : 'cookie', version: deps.version };
    res.json(out);
  });

  app.get(EXPLORER_ROUTES.auth, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (!isLoopbackHost(req.headers)) {
      res.status(403).type('text/plain').send('Host not allowed');
      return;
    }
    const result = sessions.exchange(req.query.t);
    if (!result || deps.port === undefined) {
      res.status(401).type('html').send(SIGN_IN_FAILED);
      return;
    }
    deps.onActivity?.();
    res.cookie(SessionStore.cookieName(deps.port), result.sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: sessions.maxAgeSeconds * 1000,
    });
    res.redirect(303, `/${result.redirect}`);
  });
}
