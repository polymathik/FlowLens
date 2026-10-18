/**
 * Explorer served by the daemon: browser sign-in (one-time code → cookie),
 * cookie scope + Origin/Host checks, per-project canvas API on the pooled
 * graph, health summary caching per graph revision, project removal and
 * static SPA serving.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectWithStatus } from '../../src/contracts/projects.js';
import type { AuthCodeResponse, ExplorerHealthSummary } from '../../src/contracts/canvas/explorer.js';
import type { CanvasSummary } from '../../src/contracts/canvas/api.js';
import type { HealthReport } from '../../src/contracts/health.js';
import type { Entity } from '../../src/contracts/entities.js';
import { createExplorerMount } from '../../src/service/explorer.js';
import { EXPLORER_CSP } from '../../src/service/explorer-static.js';
import { locateCanvas } from '../../src/cli/canvas-host/package-paths.js';
import { startHarness, type Harness } from '../helpers/daemon-harness.js';
import { tempDir } from '../helpers/service-env.js';
import { createIndexedFixture, type IndexedFixture } from '../canvas/helpers/fixture-project.js';

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }

function raw(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

let h: Harness;
let fx: IndexedFixture;
let project: ProjectWithStatus;
let port: number;
let cookie: string;
let pkg: string;

async function signIn(redirect = '#/home'): Promise<{ res: Res; code: string }> {
  const c = h.client();
  const minted = await c.request<AuthCodeResponse>('POST', '/api/auth/code', { redirect });
  c.destroy();
  return { res: await raw(port, 'GET', `/auth?t=${encodeURIComponent(minted.code)}`), code: minted.code };
}

beforeAll(async () => {
  pkg = await tempDir('flowlens-explorer-pkg-');
  const app = join(pkg, 'dist', 'canvas', 'app');
  await mkdir(join(app, 'assets'), { recursive: true });
  await writeFile(join(pkg, 'package.json'), '{"name":"flowlens"}');
  await writeFile(join(app, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(app, 'assets', 'index-abc.js'), 'console.log(1)');
  h = await startHarness({ port: 0, mount: createExplorerMount({ locations: locateCanvas(pkg) }) });
  port = h.daemon.info.port;
  fx = await createIndexedFixture();
  const c = h.client();
  project = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: fx.rootDir, register: true });
  c.destroy();
  const { res } = await signIn(`#/p/${project.id}/health`);
  cookie = String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];
}, 90_000);

afterAll(async () => {
  await h?.stop();
  await fx?.cleanup();
});

const browser = (extra: Record<string, string> = {}) => ({ Cookie: cookie, Host: `127.0.0.1:${port}`, ...extra });

describe('explorer sign-in', () => {
  it('exchanges a one-time code for an HttpOnly SameSite=Strict cookie and redirects to the hash', async () => {
    const { res, code } = await signIn(`#/p/${project.id}/map`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/#/p/${project.id}/map`);
    const setCookie = String(res.headers['set-cookie']?.[0]);
    expect(setCookie).toMatch(new RegExp(`^flowlens_session_${port}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const again = await raw(port, 'GET', `/auth?t=${encodeURIComponent(code)}`);
    expect(again.status).toBe(401); // single use
  });

  it('rejects unknown codes, foreign Hosts and open redirects', async () => {
    expect((await raw(port, 'GET', '/auth?t=not-a-real-code-at-all')).status).toBe(401);
    const c = h.client();
    const minted = await c.request<AuthCodeResponse>('POST', '/api/auth/code', { redirect: 'https://evil.example/' });
    c.destroy();
    expect((await raw(port, 'GET', `/auth?t=${minted.code}`, { Host: 'evil.example' })).status).toBe(403);
    const ok = await raw(port, 'GET', `/auth?t=${minted.code}`);
    expect(ok.headers.location).toBe('/#/home');
  });

  it('only a bearer client can mint codes', async () => {
    const res = await raw(port, 'POST', '/api/auth/code', browser({ Origin: `http://127.0.0.1:${port}` }), '{}');
    expect(res.status).toBe(401);
  });
});

describe('cookie scope and origin checks', () => {
  it('allows explorer reads with the cookie', async () => {
    const res = await raw(port, 'GET', '/api/session', browser());
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).via).toBe('cookie');
    expect((await raw(port, 'GET', '/api/projects', browser())).status).toBe(200);
  });

  it('refuses the cookie on CLI-only routes', async () => {
    expect((await raw(port, 'GET', '/api/ping', browser())).status).toBe(401);
    const rpc = await raw(port, 'POST', `/api/projects/${project.id}/rpc`, browser({ Origin: `http://127.0.0.1:${port}` }), '{"method":"getAllNodes"}');
    expect(rpc.status).toBe(401);
    expect((await raw(port, 'POST', '/api/shutdown', browser({ Origin: `http://127.0.0.1:${port}` }), '{}')).status).toBe(401);
  });

  it('needs a same-origin Origin for writes and refuses cross-site requests', async () => {
    const path = `/api/projects/${project.id}/canvas/architecture/preview`;
    const body = JSON.stringify({ layers: [] });
    expect((await raw(port, 'POST', path, browser(), body)).status).toBe(403);
    expect((await raw(port, 'POST', path, browser({ Origin: 'http://evil.example' }), body)).status).toBe(403);
    expect((await raw(port, 'GET', '/api/projects', browser({ 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
    expect((await raw(port, 'GET', '/api/projects', browser({ Host: 'evil.example' }))).status).toBe(403);
    expect((await raw(port, 'POST', path, browser({ Origin: `http://127.0.0.1:${port}` }), body)).status).toBe(200);
  });

  it('a bad cookie is just unauthorized', async () => {
    expect((await raw(port, 'GET', '/api/projects', { Cookie: `flowlens_session_${port}=nope` })).status).toBe(401);
  });
});

describe('per-project explorer API', () => {
  it('serves the canvas graph API from the pooled graph', async () => {
    const res = await raw(port, 'GET', `/api/projects/${project.id}/canvas/summary`, browser());
    const s = JSON.parse(res.body) as CanvasSummary;
    expect(s.file_count).toBe(9);
    expect(s.cycle_count).toBe(1);
    expect(s.violation_count).toBe(2); // import + the cross-file call it carries (Phase 8 resolution)
    const ents = JSON.parse((await raw(port, 'GET', `/api/projects/${project.id}/canvas/entities`, browser())).body) as Entity[];
    expect(ents.length).toBeGreaterThan(9);
  });

  it('caches the health summary per graph revision', async () => {
    const get = async () => JSON.parse((await raw(port, 'GET', `/api/projects/${project.id}/health/summary`, browser())).body) as ExplorerHealthSummary;
    const first = await get();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(first.grade);
    expect(first.counts.cycles).toBe(1);
    const second = await get();
    expect(second.cached).toBe(true);
    expect(second.revision).toBe(first.revision);
    const store = await h.remote(fx.rootDir);
    await store.putNode({ ...(await store.getNodesByKind('file'))[0], id: 'extra-node', name: 'extra' } as Entity);
    const third = await get();
    expect(third.revision).toBeGreaterThan(first.revision);
    expect(third.cached).toBe(false);
    await store.deleteNode('extra-node');
    await store.close();
  });

  it('returns the full report and a downloadable HTML/MD file', async () => {
    const report = JSON.parse((await raw(port, 'GET', `/api/projects/${project.id}/health`, browser())).body) as HealthReport;
    expect(report.findings.some((f) => f.kind === 'cycle')).toBe(true);
    expect(report.findings.every((f) => typeof f.fix_prompt === 'string' && f.focus.identifier)).toBe(true);
    const html = await raw(port, 'GET', `/api/projects/${project.id}/health/report?format=html`, browser());
    expect(html.headers['content-disposition']).toMatch(/attachment; filename="flowlens-health-sample-app\.html"/);
    expect(html.body).toContain('<html');
    const md = await raw(port, 'GET', `/api/projects/${project.id}/health/report?format=md`, browser());
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
  });

  it('removes a project from the registry', async () => {
    const other = await tempDir('flowlens-other-');
    await mkdir(join(other, '.flowlens'), { recursive: true });
    const c = h.client();
    const p = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: other, register: true });
    c.destroy();
    const del = await raw(port, 'DELETE', `/api/projects/${p.id}`, browser({ Origin: `http://127.0.0.1:${port}` }));
    expect(JSON.parse(del.body)).toEqual({ ok: true, removed: true });
    const list = JSON.parse((await raw(port, 'GET', '/api/projects', browser())).body) as ProjectWithStatus[];
    expect(list.map((x) => x.id)).not.toContain(p.id);
    expect((await raw(port, 'DELETE', `/api/projects/${p.id}`, browser({ Origin: `http://127.0.0.1:${port}` }))).status).toBe(404);
  });
});

describe('explorer static UI', () => {
  it('serves index.html with a strict CSP and no framing', async () => {
    const res = await raw(port, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toBe(EXPLORER_CSP);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('serves immutable assets, 404s missing ones and falls back for client routes', async () => {
    const asset = await raw(port, 'GET', '/assets/index-abc.js');
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await raw(port, 'GET', '/assets/missing.js')).status).toBe(404);
    const spa = await raw(port, 'GET', '/p/123/map');
    expect(spa.body).toContain('<div id="root">');
    const api = await raw(port, 'GET', '/api/nope', browser());
    expect(api.headers['content-type']).toMatch(/json/);
  });

  it('refuses a foreign Host for the UI too', async () => {
    expect((await raw(port, 'GET', '/', { Host: 'evil.example' })).status).toBe(403);
  });
});

describe('explorer without a built UI', () => {
  it('explains how to build it (503)', async () => {
    const empty = await tempDir('flowlens-nobuild-');
    await writeFile(join(empty, 'package.json'), '{"name":"flowlens"}');
    await mkdir(join(empty, 'src', 'canvas'), { recursive: true });
    await writeFile(join(empty, 'src', 'canvas', 'index.html'), '');
    const { startDaemon } = await import('../../src/service/daemon.js');
    const d = await startDaemon({ port: 0, writeInfo: false, log: () => {}, mount: createExplorerMount({ locations: locateCanvas(empty) }) });
    try {
      const res = await raw(d.info.port, 'GET', '/');
      expect(res.status).toBe(503);
      expect(res.body).toContain('npm run build');
    } finally {
      await d.shutdown();
    }
  });
});
