import { describe, it, expect } from 'vitest';
import { readCookie, safeRedirect, SessionStore } from '../../../src/service/sessions.js';
import { authenticateBrowser, checkBrowserOrigin, cookieRouteAllowed } from '../../../src/service/browser-auth.js';
import { HealthCache } from '../../../src/service/health-cache.js';
import type { HealthReport } from '../../../src/contracts/health.js';

describe('SessionStore', () => {
  it('codes are single-use and expire; sessions slide', () => {
    let now = 1_000;
    const s = new SessionStore(60_000, 3_600_000, () => now);
    const code = s.mintCode('#/p/x/health');
    const ex = s.exchange(code)!;
    expect(ex.redirect).toBe('#/p/x/health');
    expect(s.exchange(code)).toBeNull();
    expect(s.validate(ex.sessionId)).toBe(true);
    const late = s.mintCode();
    now += 60_001;
    expect(s.exchange(late)).toBeNull();
    now += 3_000_000;
    expect(s.validate(ex.sessionId)).toBe(true); // slid forward on the earlier validate
    now += 3_600_001;
    expect(s.validate(ex.sessionId)).toBe(false);
    expect(s.validate(undefined)).toBe(false);
    expect(s.exchange(123)).toBeNull();
  });

  it('only redirects to safe in-app hashes', () => {
    expect(safeRedirect('#/p/abc/map/entity/src%2Fa.ts?overlay=cycles')).toBe('#/p/abc/map/entity/src%2Fa.ts?overlay=cycles');
    for (const bad of ['https://evil', '//evil', '#/<script>', 42, undefined, '#/a b']) expect(safeRedirect(bad)).toBe('#/home');
  });

  it('cookie name carries the port; header parsing', () => {
    expect(SessionStore.cookieName(4280)).toBe('flowlens_session_4280');
    expect(readCookie('a=1; flowlens_session_1=xyz; b=2', 'flowlens_session_1')).toBe('xyz');
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});

describe('browser access policy', () => {
  it('limits cookie auth to explorer routes', () => {
    expect(cookieRouteAllowed('GET', '/api/projects')).toBe(true);
    expect(cookieRouteAllowed('DELETE', '/api/projects/abc')).toBe(true);
    expect(cookieRouteAllowed('POST', '/api/projects/abc/canvas/architecture')).toBe(true);
    expect(cookieRouteAllowed('GET', '/api/projects/abc/health/summary')).toBe(true);
    expect(cookieRouteAllowed('GET', '/api/projects/abc/events')).toBe(true);
    for (const [m, p] of [['POST', '/api/projects/abc/rpc'], ['POST', '/api/projects/resolve'], ['POST', '/api/shutdown'], ['POST', '/api/auth/code'], ['POST', '/api/projects/abc/leases'], ['POST', '/api/projects/abc/close'], ['DELETE', '/api/projects/abc/canvas/x']]) {
      expect(cookieRouteAllowed(m, p), `${m} ${p}`).toBe(false);
    }
  });

  it('checks Origin and fetch metadata', () => {
    const host = '127.0.0.1:4280';
    expect(checkBrowserOrigin('GET', { host })).toBeNull();
    expect(checkBrowserOrigin('GET', { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(checkBrowserOrigin('POST', { host })?.code).toBe('forbidden_host');
    expect(checkBrowserOrigin('GET', { host, origin: 'http://localhost:4280' })?.code).toBe('forbidden_host');
    expect(checkBrowserOrigin('GET', { host, 'sec-fetch-site': 'same-site' })?.code).toBe('forbidden_host');
  });

  it('needs a valid session for the daemon port', () => {
    const s = new SessionStore();
    const { sessionId } = s.exchange(s.mintCode())!;
    const headers = { host: '127.0.0.1:9', cookie: `flowlens_session_9=${sessionId}` };
    expect(authenticateBrowser(s, 9, 'GET', '/api/projects', headers)).toBeNull();
    expect(authenticateBrowser(s, 10, 'GET', '/api/projects', headers)?.code).toBe('unauthorized');
    expect(authenticateBrowser(undefined, 9, 'GET', '/api/projects', headers)?.code).toBe('unauthorized');
  });
});

describe('HealthCache', () => {
  it('reuses a report per fingerprint, recomputes on change or TTL, shares in-flight work', async () => {
    let now = 0;
    let calls = 0;
    const cache = new HealthCache(1000, () => now);
    const compute = async () => ({ score: ++calls }) as unknown as HealthReport;
    const [a, b] = await Promise.all([cache.get('p', 'k1', compute), cache.get('p', 'k1', compute)]);
    expect(calls).toBe(1);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect((await cache.get('p', 'k2', compute)).report.score).toBe(2);
    now += 1001;
    expect((await cache.get('p', 'k2', compute)).cached).toBe(false);
    await expect(cache.get('q', 'k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await cache.get('q', 'k', compute)).cached).toBe(false); // failures are not cached
  });
});
