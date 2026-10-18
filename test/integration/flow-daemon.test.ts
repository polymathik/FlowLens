/**
 * Flow REST routes served by the daemon:
 *   GET /api/projects/:id/canvas/flow/entry-points
 *   GET /api/projects/:id/canvas/flow/trace
 * Auth (cookie GET allowed under /canvas, no cookie → 401, bearer ok),
 * query validation (400), unknown entity (404 + suggestions), ambiguous
 * (409 + candidates), payload shapes, per-project routing and cache
 * invalidation when the graph changes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectWithStatus } from '../../src/contracts/projects.js';
import type { AuthCodeResponse } from '../../src/contracts/canvas/explorer.js';
import { FlowTraceSchema, EntryPointSchema, type FlowEntryPointsResponse, type FlowErrorBody } from '../../src/contracts/flow.js';
import { createExplorerMount } from '../../src/service/explorer.js';
import { locateCanvas } from '../../src/cli/canvas-host/package-paths.js';
import { startHarness, type Harness } from '../helpers/daemon-harness.js';
import { tempDir } from '../helpers/service-env.js';
import { createFlowFixture, type FlowFixture } from '../helpers/flow-fixture.js';
import { createIndexedFixture, type IndexedFixture } from '../canvas/helpers/fixture-project.js';

interface Res { status: number; body: string }

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on('error', reject);
  });
}

let h: Harness;
let fx: FlowFixture;
let other: IndexedFixture;
let project: ProjectWithStatus;
let otherProject: ProjectWithStatus;
let port: number;
let cookie: string;

const base = () => `/api/projects/${project.id}/canvas/flow`;
const browser = () => ({ Cookie: cookie, Host: `127.0.0.1:${port}` });
const json = <T>(r: Res): T => JSON.parse(r.body) as T;

beforeAll(async () => {
  const pkg = await tempDir('flowlens-flow-pkg-');
  const app = join(pkg, 'dist', 'canvas', 'app');
  await mkdir(join(app, 'assets'), { recursive: true });
  await writeFile(join(pkg, 'package.json'), '{"name":"flowlens"}');
  await writeFile(join(app, 'index.html'), '<!doctype html><div id="root"></div>');
  h = await startHarness({ port: 0, mount: createExplorerMount({ locations: locateCanvas(pkg) }) });
  port = h.daemon.info.port;
  fx = await createFlowFixture();
  other = await createIndexedFixture();
  const c = h.client();
  project = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: fx.rootDir, register: true });
  otherProject = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: other.rootDir, register: true });
  const minted = await c.request<AuthCodeResponse>('POST', '/api/auth/code', { redirect: '#/home' });
  c.destroy();
  const signIn = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/auth?t=${encodeURIComponent(minted.code)}` }, resolve).on('error', reject);
  });
  cookie = String(signIn.headers['set-cookie']?.[0] ?? '').split(';')[0];
  signIn.resume();
}, 90_000);

afterAll(async () => {
  await h?.stop();
  await fx?.cleanup();
  await other?.cleanup();
});

describe('auth', () => {
  it('serves GET with the explorer cookie and with the bearer token, refuses anonymous callers', async () => {
    expect((await get(port, `${base()}/entry-points`, browser())).status).toBe(200);
    expect((await get(port, `${base()}/entry-points`, { Authorization: `Bearer ${h.daemon.info.token}` })).status).toBe(200);
    expect((await get(port, `${base()}/entry-points`)).status).toBe(401);
    expect((await get(port, `${base()}/entry-points`, { Cookie: `flowlens_session_${port}=nope` })).status).toBe(401);
  });

  it('applies the cookie origin checks like the other canvas routes', async () => {
    expect((await get(port, `${base()}/entry-points`, { ...browser(), Host: 'evil.example' })).status).toBe(403);
    expect((await get(port, `${base()}/trace?entity=x`, { ...browser(), 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });

  it('404s an unknown project', async () => {
    expect((await get(port, '/api/projects/nope/canvas/flow/entry-points', browser())).status).toBe(404);
  });
});

describe('GET /canvas/flow/entry-points', () => {
  it('lists entry points with kinds, counts and paging', async () => {
    const r = await get(port, `${base()}/entry-points`, browser());
    const body = json<FlowEntryPointsResponse>(r);
    body.entry_points.forEach((e) => EntryPointSchema.parse(e));
    expect(body.total).toBe(body.entry_points.length);
    expect(body.truncated).toBe(false);
    expect(body.entry_points.map((e) => e.label)).toEqual(expect.arrayContaining(['GET /api/users', 'cli: serve', 'page /']));
    expect(body.entry_points.some((e) => e.kind === 'test')).toBe(false);
    expect(body.counts_by_kind.http_route).toBeGreaterThanOrEqual(9);

    const paged = json<FlowEntryPointsResponse>(await get(port, `${base()}/entry-points?kind=http_route,cli_command&max=2`, browser()));
    expect(paged.entry_points).toHaveLength(2);
    expect(paged).toMatchObject({ truncated: true });
    expect(paged.total).toBe(body.counts_by_kind.http_route + body.counts_by_kind.cli_command);

    const tests = json<FlowEntryPointsResponse>(await get(port, `${base()}/entry-points?kind=test&include_tests=1`, browser()));
    expect(tests.entry_points.map((e) => e.kind)).toEqual(['test']);
    const scoped = json<FlowEntryPointsResponse>(await get(port, `${base()}/entry-points?path=src/routes`, browser()));
    expect(scoped.entry_points.every((e) => e.file.startsWith('src/routes'))).toBe(true);
  });

  it('rejects bad queries with a FlowErrorBody', async () => {
    for (const q of ['kind=nope', 'max=0', 'max=abc', 'max=5000']) {
      const r = await get(port, `${base()}/entry-points?${q}`, browser());
      expect(r.status, q).toBe(400);
      expect(json<FlowErrorBody>(r)).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    }
  });
});

describe('GET /canvas/flow/trace', () => {
  it('returns a contract-valid trace for an entry label', async () => {
    const r = await get(port, `${base()}/trace?entity=${encodeURIComponent('GET /api/users')}&depth=3`, browser());
    expect(r.status).toBe(200);
    const trace = FlowTraceSchema.parse(JSON.parse(r.body));
    expect(trace.root).toMatchObject({ label: 'GET /api/users', kind: 'http_route' });
    expect(trace.direction).toBe('out');
    expect(trace.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['listUsers', 'findUsers', 'query']));
    expect(trace.stats.depth_reached).toBeLessThanOrEqual(3);
    expect(trace.lanes.length).toBeGreaterThanOrEqual(3);
  });

  it('supports direction=in, max_nodes and follow', async () => {
    const inbound = FlowTraceSchema.parse(json(await get(port, `${base()}/trace?entity=${encodeURIComponent('src/db/client.ts/query')}&direction=in`, browser())));
    expect(inbound.direction).toBe('in');
    expect(inbound.triggers.map((t) => t.label)).toContain('GET /api/users');
    const small = FlowTraceSchema.parse(json(await get(port, `${base()}/trace?entity=${encodeURIComponent('GET /api/users')}&max_nodes=2`, browser())));
    expect(small.nodes).toHaveLength(2);
    expect(small.truncated).toBe(true);
    const calls = FlowTraceSchema.parse(json(await get(port, `${base()}/trace?entity=${encodeURIComponent('GET /api/users')}&follow=call`, browser())));
    expect(calls.hops.every((x) => x.type === 'call')).toBe(true);
  });

  it('400 for missing / invalid parameters', async () => {
    const cases = ['', 'entity=x&depth=0', 'entity=x&depth=6', 'entity=x&direction=sideways', 'entity=x&max_nodes=1000', 'entity=x&follow=import'];
    for (const q of cases) {
      const r = await get(port, `${base()}/trace?${q}`, browser());
      expect(r.status, q).toBe(400);
      expect(json<FlowErrorBody>(r).error.code).toBe('bad_request');
    }
  });

  it('404 with did-you-mean suggestions, 409 with candidates', async () => {
    const nf = await get(port, `${base()}/trace?entity=${encodeURIComponent('GET /api/userz')}`, browser());
    expect(nf.status).toBe(404);
    expect(json<FlowErrorBody>(nf).suggestions).toContain('GET /api/users');
    const amb = await get(port, `${base()}/trace?entity=step`, browser());
    expect(amb.status).toBe(409);
    const body = json<FlowErrorBody>(amb);
    expect(body.error.code).toBe('ambiguous');
    expect(body.candidates!.length).toBeGreaterThan(1);
    const retry = await get(port, `${base()}/trace?entity=${encodeURIComponent(body.candidates![0].id)}`, browser());
    expect(retry.status).toBe(200);
  });

  it('is scoped to the project in the URL', async () => {
    const r = await get(port, `/api/projects/${otherProject.id}/canvas/flow/trace?entity=${encodeURIComponent('GET /api/users')}`, browser());
    expect(r.status).toBe(404); // sample-app has no such route
    const list = json<FlowEntryPointsResponse>(await get(port, `/api/projects/${otherProject.id}/canvas/flow/entry-points?kind=http_route,cli_command,page_route`, browser()));
    expect(list.entry_points.every((e) => !e.label.startsWith('GET /api/users'))).toBe(true);
  });

  it('picks up changes to the graph (cache keyed by revision)', async () => {
    const before = json<FlowEntryPointsResponse>(await get(port, `${base()}/entry-points?kind=http_route`, browser())).total;
    await writeFile(join(fx.rootDir, 'src', 'extra.ts'), "import express from 'express';\nconst a = express();\na.get('/extra', function extra() { return 1; });\n");
    const store = await h.remote(fx.rootDir);
    const { runIndex } = await import('../../src/indexer/indexer.js');
    await runIndex({
      rootDir: fx.rootDir, graphStore: store, fileIndexPath: join(fx.flowlensDir, 'file_index.json'), incremental: true,
      config: { exclude: [], languages: { typescript: true, javascript: true }, ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' } },
    });
    await store.close();
    const after = json<FlowEntryPointsResponse>(await get(port, `${base()}/entry-points?kind=http_route`, browser())).total;
    expect(after).toBe(before + 1);
  });
});
