/**
 * Browser access policy for the explorer (cookie sessions).
 *
 * - Bearer token (CLI clients): every route, as before.
 * - Session cookie (browser): only the explorer routes, and
 *   * Host must be loopback (checked first by `authenticate`, DNS rebinding);
 *   * any `Origin` must be exactly `http://<Host>` (cross-origin pages are refused);
 *   * state-changing methods must send that `Origin` (CSRF; SameSite=Strict is the
 *     first line, the Origin check the second — OWASP CSRF cheat sheet);
 *   * `Sec-Fetch-Site`, when the browser sends it, must be `same-origin` or `none`.
 * Never via cookie: RPC, leases, close, resolve, shutdown, minting codes.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { ServiceError } from './errors.js';
import { readCookie, SessionStore } from './sessions.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const COOKIE_ROUTES: Array<{ methods: Set<string>; re: RegExp }> = [
  { methods: new Set(['GET']), re: /^\/api\/session$/ },
  { methods: new Set(['GET']), re: /^\/api\/projects$/ },
  { methods: new Set(['GET', 'DELETE']), re: /^\/api\/projects\/[^/]+$/ },
  { methods: new Set(['GET', 'POST']), re: /^\/api\/projects\/[^/]+\/canvas(\/.*)?$/ },
  { methods: new Set(['PUT']), re: /^\/api\/projects\/[^/]+\/canvas\/zones$/ }, // zone overrides (Origin required)
  { methods: new Set(['DELETE']), re: /^\/api\/projects\/[^/]+\/canvas\/history(\/topology\/build)?$/ }, // clear history / cancel build (Origin required)
  { methods: new Set(['GET']), re: /^\/api\/projects\/[^/]+\/health(\/summary|\/report)?$/ },
  { methods: new Set(['GET']), re: /^\/api\/projects\/[^/]+\/events$/ },
];

export function cookieRouteAllowed(method: string, path: string): boolean {
  if (path === '/api/projects/resolve') return false;
  return COOKIE_ROUTES.some((r) => r.methods.has(method) && r.re.test(path));
}

/** Null when the Origin/fetch-metadata headers fit a same-origin browser request. */
export function checkBrowserOrigin(method: string, headers: IncomingHttpHeaders): ServiceError | null {
  const origin = headers.origin;
  const expected = `http://${headers.host ?? ''}`;
  if (origin !== undefined && origin !== expected) {
    return new ServiceError('forbidden_host', `Origin "${origin}" not allowed`);
  }
  if (!SAFE.has(method) && origin === undefined) {
    return new ServiceError('forbidden_host', 'Origin header required');
  }
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    return new ServiceError('forbidden_host', `Cross-site request (${site}) not allowed`);
  }
  return null;
}

/**
 * Cookie-based fallback after the bearer check failed with `unauthorized`.
 * Returns null when the browser session may make this request.
 */
export function authenticateBrowser(
  sessions: SessionStore | undefined,
  port: number | undefined,
  method: string,
  path: string,
  headers: IncomingHttpHeaders,
): ServiceError | null {
  const unauthorized = new ServiceError('unauthorized', 'Sign in again: run "flowlens canvas" in a terminal');
  if (!sessions || port === undefined) return unauthorized;
  const sid = readCookie(headers.cookie, SessionStore.cookieName(port));
  if (!sessions.validate(sid)) return unauthorized;
  if (!cookieRouteAllowed(method, path)) return new ServiceError('unauthorized', 'This route needs the CLI token');
  return checkBrowserOrigin(method, headers);
}
