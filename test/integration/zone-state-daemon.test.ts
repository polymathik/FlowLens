/**
 * Community state over the daemon: GET|PUT /api/projects/:id/canvas/zones/state —
 * bearer and explorer-cookie auth, same-origin rule for writes, body validation and
 * size cap (2 MB), atomic per-project persistence in `.flowlens/zone-state.json`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectWithStatus } from '../../src/contracts/projects.js';
import type { AuthCodeResponse } from '../../src/contracts/canvas/explorer.js';
import { EMPTY_ZONE_STATE, ZONE_STATE_MAX_BYTES, type ZoneOverridesError, type ZoneState } from '../../src/contracts/zones.js';
import { createExplorerMount } from '../../src/service/explorer.js';
import { startHarness, type Harness } from '../helpers/daemon-harness.js';
import { tempDir } from '../helpers/service-env.js';
import { createIndexedFixture, type IndexedFixture } from '../canvas/helpers/fixture-project.js';

interface Res { status: number; body: string }

function raw(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

let h: Harness;
let fx: IndexedFixture;
let other: string;
let project: ProjectWithStatus;
let otherProject: ProjectWithStatus;
let port: number;
let cookie: string;

const statePath = (id: string): string => `/api/projects/${id}/canvas/zones/state`;
const bearer = (): Record<string, string> => ({ Authorization: `Bearer ${h.daemon.info.token}` });
const browser = (extra: Record<string, string> = {}): Record<string, string> => ({ Cookie: cookie, Host: `127.0.0.1:${port}`, ...extra });
const sameOrigin = (): Record<string, string> => ({ Origin: `http://127.0.0.1:${port}` });
const json = <T>(r: Res): T => JSON.parse(r.body) as T;

const doc: ZoneState = { version: 1, assignment: { 'src/a.ts': 'pkg/auth', 'src/b.ts': 'pkg/auth', 'src/c.ts': 'pkg/billing' } };
const file = (root: string): string => join(root, '.flowlens', 'zone-state.json');

beforeAll(async () => {
  h = await startHarness({ port: 0, mount: createExplorerMount() });
  port = h.daemon.info.port;
  fx = await createIndexedFixture();
  other = await tempDir('flowlens-zone-state-other-');
  await mkdir(join(other, '.flowlens'), { recursive: true });
  const c = h.client();
  project = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: fx.rootDir, register: true });
  otherProject = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: other, register: true });
  const minted = await c.request<AuthCodeResponse>('POST', '/api/auth/code', { redirect: '#/home' });
  c.destroy();
  const signedIn = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/auth?t=${encodeURIComponent(minted.code)}` }, resolve).on('error', reject);
  });
  cookie = String(signedIn.headers['set-cookie']?.[0] ?? '').split(';')[0];
}, 90_000);

afterAll(async () => {
  await h?.stop();
  await fx?.cleanup();
});

describe('GET|PUT /canvas/zones/state', () => {
  it('requires authentication', async () => {
    expect((await raw(port, 'GET', statePath(project.id))).status).toBe(401);
    expect((await raw(port, 'PUT', statePath(project.id), {}, JSON.stringify(doc))).status).toBe(401);
    expect((await raw(port, 'GET', statePath(project.id), { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await raw(port, 'GET', statePath(project.id), { ...bearer(), Host: 'evil.example' })).status).toBe(403);
  });

  it('answers an empty state before anything was saved (bearer and cookie)', async () => {
    const res = await raw(port, 'GET', statePath(project.id), bearer());
    expect(res.status).toBe(200);
    expect(json(res)).toEqual(EMPTY_ZONE_STATE);
    expect((await raw(port, 'GET', statePath(project.id), browser())).status).toBe(200);
  });

  it('PUT stores atomically in <project>/.flowlens/zone-state.json and returns what was stored', async () => {
    const res = await raw(port, 'PUT', statePath(project.id), bearer(), JSON.stringify({ ...doc, unknown: 'dropped' }));
    expect(res.status).toBe(200);
    expect(json(res)).toEqual(doc);
    expect(JSON.parse(await readFile(file(fx.rootDir), 'utf-8'))).toEqual(doc);
    expect((await readdir(join(fx.rootDir, '.flowlens'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(json(await raw(port, 'GET', statePath(project.id), browser()))).toEqual(doc);
  });

  it('does not touch zones.json (overrides) and is per project', async () => {
    expect(json(await raw(port, 'GET', `/api/projects/${project.id}/canvas/zones`, bearer()))).toMatchObject({ version: 1, zones: {} });
    expect(json(await raw(port, 'GET', statePath(otherProject.id), bearer()))).toEqual(EMPTY_ZONE_STATE);
    const mine: ZoneState = { version: 1, assignment: { 'x.ts': 'other/zone' } };
    expect((await raw(port, 'PUT', statePath(otherProject.id), bearer(), JSON.stringify(mine))).status).toBe(200);
    expect(json(await raw(port, 'GET', statePath(project.id), bearer()))).toEqual(doc);
    expect(JSON.parse(await readFile(file(other), 'utf-8'))).toEqual(mine);
  });

  it('404s an unknown project', async () => {
    expect((await raw(port, 'GET', statePath('0123456789ab'), bearer())).status).toBe(404);
    expect((await raw(port, 'PUT', statePath('0123456789ab'), bearer(), JSON.stringify(doc))).status).toBe(404);
  });

  it('a browser session may PUT only with a same-origin Origin', async () => {
    const body = JSON.stringify({ version: 1, assignment: { 'src/a.ts': 'pkg/via-browser' } });
    expect((await raw(port, 'PUT', statePath(project.id), browser(), body)).status).toBe(403);
    expect((await raw(port, 'PUT', statePath(project.id), browser({ Origin: 'http://evil.example' }), body)).status).toBe(403);
    expect((await raw(port, 'PUT', statePath(project.id), browser({ ...sameOrigin(), 'Sec-Fetch-Site': 'cross-site' }), body)).status).toBe(403);
    expect(json<ZoneState>(await raw(port, 'GET', statePath(project.id), bearer())).assignment['src/a.ts']).toBe('pkg/auth');
    const ok = await raw(port, 'PUT', statePath(project.id), browser(sameOrigin()), body);
    expect(ok.status).toBe(200);
    expect(json<ZoneState>(ok).assignment['src/a.ts']).toBe('pkg/via-browser');
  });

  it('the cookie gains PUT for this route only; DELETE and other sub-paths stay refused', async () => {
    expect((await raw(port, 'DELETE', statePath(project.id), browser(sameOrigin()))).status).toBe(401);
    expect((await raw(port, 'PUT', `${statePath(project.id)}/extra`, browser(sameOrigin()), '{}')).status).toBe(401);
  });

  it('rejects invalid bodies with 400 and issues, keeping the stored document', async () => {
    const before = await readFile(file(fx.rootDir), 'utf-8');
    const bad = (body: string): Promise<Res> => raw(port, 'PUT', statePath(project.id), bearer(), body);
    const wrong = await bad(JSON.stringify({ version: 1, assignment: { 'a.ts': 7 } }));
    expect(wrong.status).toBe(400);
    const err = json<ZoneOverridesError>(wrong);
    expect(err.error.code).toBe('bad_request');
    expect(err.issues[0].path).toBe('assignment.a.ts');
    expect((await bad(JSON.stringify({ version: 2, assignment: {} }))).status).toBe(400);
    expect((await bad('{"version":1,"assignment":{"__proto__":"x"}}')).status).toBe(400);
    expect((await bad('[]')).status).toBe(400);
    expect((await bad('{not json')).status).toBe(400);
    expect(await readFile(file(fx.rootDir), 'utf-8')).toBe(before);
  });

  it(`accepts large states (above the 256 KB zones cap) and refuses bodies over ${ZONE_STATE_MAX_BYTES / 1024 / 1024} MB with 413`, async () => {
    const state = (n: number): ZoneState => ({ version: 1, assignment: Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/dir/file-${i}.ts`, 'pkg/some-community'])) });
    const sizeOf = (n: number): number => Buffer.byteLength(JSON.stringify(state(n)));
    expect(sizeOf(10_000)).toBeGreaterThan(256 * 1024);
    expect((await raw(port, 'PUT', statePath(project.id), bearer(), JSON.stringify(state(10_000)))).status).toBe(200);
    const huge = JSON.stringify({ version: 1, assignment: { 'a.ts': 'x'.repeat(ZONE_STATE_MAX_BYTES) } });
    expect((await raw(port, 'PUT', statePath(project.id), bearer(), huge)).status).toBe(413);
  });

  it('a corrupt zone-state.json on disk reads as empty and is kept as .corrupt', async () => {
    await writeFile(file(other), '{oops', 'utf-8');
    expect(json(await raw(port, 'GET', statePath(otherProject.id), bearer()))).toEqual(EMPTY_ZONE_STATE);
    expect(await readFile(`${file(other)}.corrupt`, 'utf-8')).toBe('{oops');
  });

  it('concurrent PUTs leave one complete document', async () => {
    const docs = Array.from({ length: 10 }, (_, i): ZoneState => ({ version: 1, assignment: { 'a.ts': `pkg/v${i}` } }));
    const results = await Promise.all(docs.map((d) => raw(port, 'PUT', statePath(project.id), bearer(), JSON.stringify(d))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(docs).toContainEqual(json<ZoneState>(await raw(port, 'GET', statePath(project.id), bearer())));
    expect((await readdir(join(fx.rootDir, '.flowlens'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
