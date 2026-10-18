/**
 * History over the daemon: GET /canvas/history (+ incremental refresh),
 * the sampled-topology job (POST build → status → GET), DELETE, auth,
 * the browser Origin rule, validation, size cap and per-project routing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectWithStatus } from '../../src/contracts/projects.js';
import type { AuthCodeResponse } from '../../src/contracts/canvas/explorer.js';
import {
  HISTORY_BUILD_BODY_MAX_BYTES, type HistoryClearResult, type HistoryErrorBody, type HistorySummary, type HistoryTopology,
  type TopologyBuildStarted, type TopologyJobStatus,
} from '../../src/contracts/history.js';
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
let plain: string;
let project: ProjectWithStatus;
let plainProject: ProjectWithStatus;
let port: number;
let cookie: string;

const base = (id: string): string => `/api/projects/${id}/canvas/history`;
const bearer = (): Record<string, string> => ({ Authorization: `Bearer ${h.daemon.info.token}` });
const browser = (extra: Record<string, string> = {}): Record<string, string> => ({ Cookie: cookie, Host: `127.0.0.1:${port}`, ...extra });
const sameOrigin = (): Record<string, string> => ({ Origin: `http://127.0.0.1:${port}` });
const json = <T>(r: Res): T => JSON.parse(r.body) as T;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForJob(id: string, state: string, timeoutMs = 60_000): Promise<TopologyJobStatus> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const s = json<TopologyJobStatus>(await raw(port, 'GET', `${base(id)}/topology/status`, bearer()));
    if (s.state === state) return s;
    if (Date.now() > until) throw new Error(`job stuck in ${s.state}`);
    await sleep(100);
  }
}

beforeAll(async () => {
  h = await startHarness({ port: 0, mount: createExplorerMount() });
  port = h.daemon.info.port;
  fx = await createIndexedFixture();
  plain = await tempDir('flowlens-history-plain-');
  await mkdir(join(plain, '.flowlens'), { recursive: true });
  const c = h.client();
  project = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: fx.rootDir, register: true });
  plainProject = await c.request<ProjectWithStatus>('POST', '/api/projects/resolve', { root: plain, register: true });
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

describe('auth and routing', () => {
  it('requires authentication on every history route', async () => {
    for (const [method, suffix] of [['GET', ''], ['DELETE', ''], ['GET', '/topology'], ['POST', '/topology/build'], ['GET', '/topology/status'], ['DELETE', '/topology/build']]) {
      const body = method === 'POST' ? '{}' : undefined;
      expect((await raw(port, method, base(project.id) + suffix, {}, body)).status, `${method} ${suffix}`).toBe(401);
      expect((await raw(port, method, base(project.id) + suffix, { Authorization: 'Bearer nope' }, body)).status).toBe(401);
      expect((await raw(port, method, base(project.id) + suffix, { Cookie: `flowlens_session_${port}=nope` }, body)).status).toBe(401);
    }
    expect((await raw(port, 'GET', base(project.id), { ...bearer(), Host: 'evil.example' })).status).toBe(403);
  });

  it('404s an unknown project; answers typed not_a_git_repo (404) for a project outside git', async () => {
    expect((await raw(port, 'GET', base('0123456789ab'), bearer())).status).toBe(404);
    expect((await raw(port, 'POST', `${base('0123456789ab')}/topology/build`, bearer(), '{}')).status).toBe(404);
    const res = await raw(port, 'GET', base(plainProject.id), bearer());
    expect(res.status).toBe(404);
    expect(json<HistoryErrorBody>(res)).toMatchObject({ ok: false, error: { code: 'not_a_git_repo' } });
    const build = await raw(port, 'POST', `${base(plainProject.id)}/topology/build`, bearer(), '{}');
    expect(build.status).toBe(404);
    expect(json<HistoryErrorBody>(build).error.code).toBe('not_a_git_repo');
    expect(json<TopologyJobStatus>(await raw(port, 'GET', `${base(plainProject.id)}/topology/status`, bearer())).state).toBe('idle');
  });
});

describe('GET /canvas/history', () => {
  it('builds the commit history on demand and caches it under .flowlens/history/', async () => {
    const res = await raw(port, 'GET', base(project.id), bearer());
    expect(res.status).toBe(200);
    const s = json<HistorySummary>(res);
    expect(s.commits).toHaveLength(4);
    expect(s.branch).toMatch(/\S/);
    expect(s.head).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.rootDir, encoding: 'utf8' }).trim());
    expect(s.build?.mode).toBe('full');
    expect(s.totals.commits).toBe(4);
    expect(s.commits[0].files.length).toBeGreaterThan(5); // the initial commit added the sample app
    expect(res.body).not.toMatch(/flowlens\.invalid|@/); // names only
    expect(await readdir(join(fx.rootDir, '.flowlens', 'history'))).toEqual(['commits.json']);
    expect(json<HistorySummary>(await raw(port, 'GET', base(project.id), browser())).commits).toHaveLength(4); // cookie works too
  });

  it('refreshes incrementally after a new commit (once the rate-limit window passed)', async () => {
    await writeFile(join(fx.rootDir, 'src', 'brand-new.ts'), 'export const fresh = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: fx.rootDir });
    execFileSync('git', ['commit', '-q', '-m', 'brand new'], {
      cwd: fx.rootDir, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.invalid' },
    });
    expect(json<HistorySummary>(await raw(port, 'GET', base(project.id), bearer())).commits).toHaveLength(4); // rate-limited: stale
    await sleep(1_100);
    const s = json<HistorySummary>(await raw(port, 'GET', base(project.id), bearer()));
    expect(s.commits).toHaveLength(5);
    expect(s.build).toMatchObject({ mode: 'incremental', commits_read: 1 });
    expect(s.commits[4].subject).toBe('brand new');
    expect(s.commits[4].files).toEqual([{ path: 'src/brand-new.ts', status: 'A', added: 1, deleted: 0 }]);
  });

  it('validates the query and honours max / first_parent', async () => {
    for (const q of ['max=0', 'max=abc', 'max=1.5', 'max=999999']) {
      const res = await raw(port, 'GET', `${base(project.id)}?${q}`, bearer());
      expect(res.status, q).toBe(400);
      expect(json<HistoryErrorBody>(res).error.code).toBe('bad_request');
    }
    const s = json<HistorySummary>(await raw(port, 'GET', `${base(project.id)}?max=2&first_parent=1`, bearer()));
    expect(s.commits).toHaveLength(2);
    expect(s).toMatchObject({ truncated: true, first_parent: true });
    expect(s.baseline?.length).toBeGreaterThan(0);
  });

  it('serves concurrent requests from one build (single-flight)', async () => {
    await raw(port, 'DELETE', base(project.id), bearer());
    const all = await Promise.all(Array.from({ length: 5 }, () => raw(port, 'GET', base(project.id), bearer())));
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(new Set(all.map((r) => r.body)).size).toBe(1);
  });
});

describe('topology job', () => {
  it('is not_built before the first job', async () => {
    await raw(port, 'DELETE', base(project.id), bearer());
    const res = await raw(port, 'GET', `${base(project.id)}/topology`, bearer());
    expect(res.status).toBe(404);
    expect(json<HistoryErrorBody>(res).error.code).toBe('not_built');
    expect(json<TopologyJobStatus>(await raw(port, 'GET', `${base(project.id)}/topology/status`, bearer()))).toMatchObject({ ok: true, state: 'idle', job_id: null });
  });

  it('validates and size-caps the build request', async () => {
    const post = (body: string): Promise<Res> => raw(port, 'POST', `${base(project.id)}/topology/build`, bearer(), body);
    for (const body of ['{"every":0}', '{"max":1}', '{"max":1000}', '{"every":"x"}', '[]']) {
      const res = await post(body);
      expect(res.status, body).toBe(400);
      expect(json<HistoryErrorBody>(res).error.code).toBe('bad_request');
    }
    expect((await post('{nope')).status).toBe(400);
    const big = JSON.stringify({ pad: 'x'.repeat(HISTORY_BUILD_BODY_MAX_BYTES + 100) });
    expect((await post(big)).status).toBe(413);
  });

  it('starts one job (202), rejects a concurrent start (409), reports progress, then serves the topology', async () => {
    const [a, b] = await Promise.all([
      raw(port, 'POST', `${base(project.id)}/topology/build`, bearer(), '{"every":2}'),
      raw(port, 'POST', `${base(project.id)}/topology/build`, bearer(), '{"every":2}'),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);
    const started = json<TopologyBuildStarted>(a.status === 202 ? a : b);
    const conflict = json<HistoryErrorBody>(a.status === 409 ? a : b);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'job_running' }, job_id: started.job_id });
    expect(started.status.state).toBe('running');

    const done = await waitForJob(project.id, 'done');
    expect(done.job_id).toBe(started.job_id);
    expect(done.progress).toMatchObject({ total: 3, done: 3, skipped: 0 }); // 5 commits, every 2: indices 0, 2, 4 (= HEAD)
    const res = await raw(port, 'GET', `${base(project.id)}/topology`, bearer());
    expect(res.status).toBe(200);
    const t = json<HistoryTopology>(res);
    expect(t.samples.length).toBe(done.progress?.total);
    expect(t.every).toBe(2);
    expect(t.samples.every((s) => s.files.length > 5 && s.edges.length > 5)).toBe(true);
    expect(t.samples[t.samples.length - 1].files.map((i) => t.files[i])).toContain('src/brand-new.ts');
    expect(json<HistoryTopology>(await raw(port, 'GET', `${base(project.id)}/topology`, browser())).samples).toHaveLength(t.samples.length);
    expect(await readdir(join(fx.rootDir, '.flowlens', 'history'))).toEqual(['commits.json', 'topology.json']);
  }, 90_000);

  it('can be cancelled with DELETE …/topology/build', async () => {
    await raw(port, 'DELETE', base(project.id), bearer());
    const start = await raw(port, 'POST', `${base(project.id)}/topology/build`, bearer(), '{}');
    expect(start.status).toBe(202);
    const res = await raw(port, 'DELETE', `${base(project.id)}/topology/build`, bearer());
    expect(res.status).toBe(200);
    expect(json<TopologyJobStatus>(res).state).toBe('cancelled');
    expect((await raw(port, 'GET', `${base(project.id)}/topology`, bearer())).status).toBe(404);
  });
});

describe('browser sessions and DELETE', () => {
  it('a cookie may POST build / DELETE only with a same-origin Origin', async () => {
    const build = `${base(project.id)}/topology/build`;
    expect((await raw(port, 'POST', build, browser(), '{"every":50}')).status).toBe(403);
    expect((await raw(port, 'POST', build, browser({ Origin: 'http://evil.example' }), '{"every":50}')).status).toBe(403);
    expect((await raw(port, 'POST', build, browser({ ...sameOrigin(), 'Sec-Fetch-Site': 'cross-site' }), '{"every":50}')).status).toBe(403);
    expect((await raw(port, 'DELETE', base(project.id), browser())).status).toBe(403);
    expect((await raw(port, 'DELETE', base(project.id), browser({ Origin: 'http://evil.example' }))).status).toBe(403);
    const ok = await raw(port, 'POST', build, browser(sameOrigin()), '{"every":50}');
    expect(ok.status).toBe(202);
    await waitForJob(project.id, 'done');
    const cleared = await raw(port, 'DELETE', base(project.id), browser(sameOrigin()));
    expect(cleared.status).toBe(200);
    expect(json<HistoryClearResult>(cleared)).toEqual({ ok: true, removed: ['commits.json', 'topology.json'] });
    expect(await readdir(join(fx.rootDir, '.flowlens'))).not.toContain('history');
  }, 90_000);

  it('the cookie gains no other DELETE on canvas routes', async () => {
    expect((await raw(port, 'DELETE', `/api/projects/${project.id}/canvas/zones`, browser(sameOrigin()))).status).toBe(401);
    expect((await raw(port, 'DELETE', `${base(project.id)}/topology`, browser(sameOrigin()))).status).toBe(401);
  });
});
