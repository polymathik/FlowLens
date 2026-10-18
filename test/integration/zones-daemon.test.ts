/**
 * Zone overrides over the daemon: GET|PUT /api/projects/:id/canvas/zones —
 * bearer and explorer-cookie auth, same-origin rule for writes, body
 * validation and size cap, atomic per-project persistence in
 * `.flowlens/zones.json`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectWithStatus } from '../../src/contracts/projects.js';
import type { AuthCodeResponse } from '../../src/contracts/canvas/explorer.js';
import { EMPTY_ZONE_OVERRIDES, ZONE_OVERRIDES_MAX_BYTES, type ZoneOverrides, type ZoneOverridesError } from '../../src/contracts/zones.js';
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

const zonesPath = (id: string): string => `/api/projects/${id}/canvas/zones`;
const bearer = (): Record<string, string> => ({ Authorization: `Bearer ${h.daemon.info.token}` });
const browser = (extra: Record<string, string> = {}): Record<string, string> => ({ Cookie: cookie, Host: `127.0.0.1:${port}`, ...extra });
const sameOrigin = (): Record<string, string> => ({ Origin: `http://127.0.0.1:${port}` });
const json = <T>(r: Res): T => JSON.parse(r.body) as T;

const doc: ZoneOverrides = {
  version: 1,
  zones: { 'folders:src': { name: 'Source', color: 4, collapsed: true } },
  pins: { 'src/index.ts': 'folders:docs' },
};

beforeAll(async () => {
  h = await startHarness({ port: 0, mount: createExplorerMount() });
  port = h.daemon.info.port;
  fx = await createIndexedFixture();
  other = await tempDir('flowlens-zones-other-');
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

describe('GET|PUT /canvas/zones', () => {
  it('requires authentication', async () => {
    expect((await raw(port, 'GET', zonesPath(project.id))).status).toBe(401);
    expect((await raw(port, 'PUT', zonesPath(project.id), {}, JSON.stringify(doc))).status).toBe(401);
    expect((await raw(port, 'GET', zonesPath(project.id), { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await raw(port, 'GET', zonesPath(project.id), { Cookie: `flowlens_session_${port}=nope` })).status).toBe(401);
    expect((await raw(port, 'GET', zonesPath(project.id), { ...bearer(), Host: 'evil.example' })).status).toBe(403);
  });

  it('answers empty overrides before anything was saved', async () => {
    const res = await raw(port, 'GET', zonesPath(project.id), bearer());
    expect(res.status).toBe(200);
    expect(json(res)).toEqual(EMPTY_ZONE_OVERRIDES);
    expect((await raw(port, 'GET', zonesPath(project.id), browser())).status).toBe(200);
  });

  it('PUT stores atomically in <project>/.flowlens/zones.json and returns what was stored', async () => {
    const res = await raw(port, 'PUT', zonesPath(project.id), bearer(), JSON.stringify({ ...doc, unknown: 'dropped' }));
    expect(res.status).toBe(200);
    expect(json(res)).toEqual(doc);
    expect(JSON.parse(await readFile(join(fx.rootDir, '.flowlens', 'zones.json'), 'utf-8'))).toEqual(doc);
    expect((await readdir(join(fx.rootDir, '.flowlens'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(json(await raw(port, 'GET', zonesPath(project.id), bearer()))).toEqual(doc);
    expect(json(await raw(port, 'GET', zonesPath(project.id), browser()))).toEqual(doc);
  });

  it('is per project', async () => {
    expect(json(await raw(port, 'GET', zonesPath(otherProject.id), bearer()))).toEqual(EMPTY_ZONE_OVERRIDES);
    const mine: ZoneOverrides = { version: 1, zones: { 'packages:x': { name: 'Other' } }, pins: {} };
    expect((await raw(port, 'PUT', zonesPath(otherProject.id), bearer(), JSON.stringify(mine))).status).toBe(200);
    expect(json(await raw(port, 'GET', zonesPath(otherProject.id), bearer()))).toEqual(mine);
    expect(json(await raw(port, 'GET', zonesPath(project.id), bearer()))).toEqual(doc);
    expect(JSON.parse(await readFile(join(other, '.flowlens', 'zones.json'), 'utf-8'))).toEqual(mine);
  });

  it('404s an unknown project', async () => {
    expect((await raw(port, 'GET', zonesPath('0123456789ab'), bearer())).status).toBe(404);
    expect((await raw(port, 'PUT', zonesPath('0123456789ab'), bearer(), JSON.stringify(doc))).status).toBe(404);
  });

  it('a browser session may PUT only with a same-origin Origin', async () => {
    const body = JSON.stringify({ ...doc, zones: { 'folders:src': { name: 'Via browser' } } });
    expect((await raw(port, 'PUT', zonesPath(project.id), browser(), body)).status).toBe(403);
    expect((await raw(port, 'PUT', zonesPath(project.id), browser({ Origin: 'http://evil.example' }), body)).status).toBe(403);
    expect((await raw(port, 'PUT', zonesPath(project.id), browser({ ...sameOrigin(), 'Sec-Fetch-Site': 'cross-site' }), body)).status).toBe(403);
    expect(json<ZoneOverrides>(await raw(port, 'GET', zonesPath(project.id), bearer())).zones['folders:src'].name).toBe('Source');
    const ok = await raw(port, 'PUT', zonesPath(project.id), browser(sameOrigin()), body);
    expect(ok.status).toBe(200);
    expect(json<ZoneOverrides>(ok).zones['folders:src']).toEqual({ name: 'Via browser' });
  });

  it('the cookie gains PUT for zones only, not for other canvas routes', async () => {
    const res = await raw(port, 'PUT', `/api/projects/${project.id}/canvas/architecture`, browser(sameOrigin()), '{"layers":[]}');
    expect(res.status).toBe(401);
    expect((await raw(port, 'DELETE', zonesPath(project.id), browser(sameOrigin()))).status).toBe(401);
  });

  it('rejects invalid bodies with 400 and issues, keeping the stored document', async () => {
    const before = await readFile(join(fx.rootDir, '.flowlens', 'zones.json'), 'utf-8');
    const bad = async (body: string): Promise<Res> => raw(port, 'PUT', zonesPath(project.id), bearer(), body);
    const wrongColor = await bad(JSON.stringify({ version: 1, zones: { 'folders:a': { color: 9 } }, pins: {} }));
    expect(wrongColor.status).toBe(400);
    const err = json<ZoneOverridesError>(wrongColor);
    expect(err.error.code).toBe('bad_request');
    expect(err.issues[0].path).toBe('zones.folders:a.color');
    expect((await bad(JSON.stringify({ version: 2, zones: {}, pins: {} }))).status).toBe(400);
    expect((await bad('{"version":1,"zones":{"__proto__":{"name":"x"}},"pins":{}}')).status).toBe(400);
    expect((await bad('[]')).status).toBe(400);
    expect((await bad('{not json')).status).toBe(400);
    expect((await raw(port, 'PUT', zonesPath(project.id), bearer())).status).toBe(400);
    expect(await readFile(join(fx.rootDir, '.flowlens', 'zones.json'), 'utf-8')).toBe(before);
  });

  it(`refuses bodies over ${ZONE_OVERRIDES_MAX_BYTES / 1024} KB with 413`, async () => {
    const withPins = (n: number): ZoneOverrides => ({
      version: 1, zones: {}, pins: Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/file-${i}.ts`, 'folders:x'])),
    });
    const sizeOf = (n: number): number => Buffer.byteLength(JSON.stringify(withPins(n)));
    let n = Math.floor(ZONE_OVERRIDES_MAX_BYTES / 40);
    while (sizeOf(n) < ZONE_OVERRIDES_MAX_BYTES + 500) n += 50;
    const res = await raw(port, 'PUT', zonesPath(project.id), bearer(), JSON.stringify(withPins(n)));
    expect(res.status).toBe(413);
    let m = n;
    while (sizeOf(m) > ZONE_OVERRIDES_MAX_BYTES - 100) m -= 50;
    expect((await raw(port, 'PUT', zonesPath(project.id), bearer(), JSON.stringify(withPins(m)))).status).toBe(200);
  });

  it('a corrupt zones.json on disk reads as empty and is kept as .corrupt', async () => {
    await writeFile(join(other, '.flowlens', 'zones.json'), '{oops', 'utf-8');
    expect(json(await raw(port, 'GET', zonesPath(otherProject.id), bearer()))).toEqual(EMPTY_ZONE_OVERRIDES);
    expect(await readFile(join(other, '.flowlens', 'zones.json.corrupt'), 'utf-8')).toBe('{oops');
  });

  it('concurrent PUTs leave one complete document', async () => {
    const docs = Array.from({ length: 10 }, (_, i): ZoneOverrides => ({ version: 1, zones: { 'folders:s': { name: `v${i}` } }, pins: {} }));
    const results = await Promise.all(docs.map((d) => raw(port, 'PUT', zonesPath(project.id), bearer(), JSON.stringify(d))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const final = json<ZoneOverrides>(await raw(port, 'GET', zonesPath(project.id), bearer()));
    expect(docs).toContainEqual(final);
    expect((await readdir(join(fx.rootDir, '.flowlens'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
