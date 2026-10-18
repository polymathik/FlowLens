/**
 * Daemon behaviour (in-process): auth, project routes, multi-project pool,
 * lease/release semantics vs direct LevelDB openers, watcher → SSE, and
 * graceful shutdown.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { runIndex } from '../../src/indexer/indexer.js';
import type { GraphChangedEvent, ProjectDetail } from '../../src/contracts/service.js';
import type { Entity } from '../../src/contracts/entities.js';
import { daemonInfoPath } from '../../src/service/daemon-info.js';
import { startHarness, TEST_CONFIG, type Harness } from '../helpers/daemon-harness.js';
import { copyFixture } from '../helpers/service-env.js';

function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

async function project(name: string): Promise<string> {
  const root = await copyFixture(name);
  mkdirSync(join(root, '.flowlens'), { recursive: true });
  await writeFile(join(root, '.flowlens', 'config.json'), JSON.stringify(TEST_CONFIG));
  return root;
}

describe('graph service daemon', () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness({ options: { leaseTtlMs: 600 } }); });
  afterEach(async () => { await h.stop(); });

  it('writes its daemon info file with mode 0600 and rejects bad tokens and foreign Host headers', async () => {
    const { statSync } = await import('node:fs');
    expect(statSync(daemonInfoPath()).mode & 0o777).toBe(0o600);
    const { port, token } = h.daemon.info;
    expect(await rawGet(port, '/api/ping', {})).toBe(401);
    expect(await rawGet(port, '/api/ping', { Authorization: 'Bearer nope' })).toBe(401);
    expect(await rawGet(port, '/api/ping', { Authorization: `Bearer ${token}` })).toBe(200);
    expect(await rawGet(port, '/api/ping', { Authorization: `Bearer ${token}`, Host: 'evil.example:80' })).toBe(403);
    // Review L2: a query-string token is accepted on the SSE route only (404 = authenticated, unknown project).
    expect(await rawGet(port, `/api/version?access_token=${token}`, {})).toBe(401);
    expect(await rawGet(port, `/api/projects?access_token=${token}`, {})).toBe(401);
    expect(await rawGet(port, `/api/projects/nope/events?access_token=${token}`, {})).toBe(404);
    expect(await rawGet(port, `/api/projects/nope/events?access_token=bad`, {})).toBe(401);
  });

  it('serves two projects at once with isolated graphs and project details', async () => {
    const a = await project('simple-project');
    const b = await project('cyclic-project');
    const [ra, rb] = await Promise.all([h.remote(a), h.remote(b)]);
    await Promise.all([ra, rb].map((store, i) => runIndex({
      rootDir: i === 0 ? a : b, graphStore: store, config: TEST_CONFIG,
      fileIndexPath: join(i === 0 ? a : b, '.flowlens', 'file_index.json'), incremental: false,
    })));
    const filesA = (await ra.getNodesByKind('file')).map((n) => n.file_path).sort();
    const filesB = (await rb.getNodesByKind('file')).map((n) => n.file_path).sort();
    expect(filesA).not.toEqual(filesB);
    const c = h.client();
    const list = await c.request<ProjectDetail[]>('GET', '/api/projects');
    expect(list).toHaveLength(2);
    expect(list.every((p) => p.graph.open && p.graph.leases === 1 && p.status === 'ok')).toBe(true);
    const detail = await c.request<ProjectDetail>('GET', `/api/projects/${ra.projectId}`);
    expect(detail.root).toBe(a);
    expect(detail.last_indexed).not.toBeNull(); // from file_index.json until the manifest lands
    c.destroy();
  }, 30_000);

  it('holds the DB while leased and releases it for direct openers when the last lease ends', async () => {
    const root = await project('simple-project');
    const remote = await h.remote(root);
    await remote.putNode({ id: 'n1', kind: 'function', name: 'n1' } as Entity);
    const direct = new LevelGraphStore();
    await expect(direct.open(join(root, '.flowlens', 'graph'))).rejects.toThrow();
    await remote.close();
    await sleep(50);
    await direct.open(join(root, '.flowlens', 'graph'));
    expect((await direct.getNode('n1'))?.name).toBe('n1');
    // While someone else holds the lock the daemon answers graph_locked, not a crash.
    const again = await h.remote(root);
    await expect(again.getAllNodes()).rejects.toMatchObject({ code: 'graph_locked', status: 423 });
    await direct.close();
    expect(await again.getAllNodes()).toHaveLength(1);
  });

  it('expires leases that stop renewing', async () => {
    const root = await project('simple-project');
    const c = h.client();
    const p = await c.request<{ id: string }>('POST', '/api/projects/resolve', { root });
    await c.request('POST', `/api/projects/${p.id}/leases`, { client: 'crashed' });
    await c.request('POST', `/api/projects/${p.id}/rpc`, { method: 'getAllNodes', args: [] });
    expect(h.daemon.deps.pool.state(p.id)).toMatchObject({ open: true, leases: 1 });
    await sleep(1200);
    expect(h.daemon.deps.pool.state(p.id)).toMatchObject({ open: false, leases: 0 });
    c.destroy();
  });

  it('streams large bulk results', async () => {
    const root = await project('simple-project');
    const remote = await h.remote(root);
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `bulk-${i}`, kind: 'variable', name: `v${i}`, file_path: 'x.ts' }) as Entity);
    await remote.putNodes(many);
    const all = await remote.getAllNodes();
    expect(all).toHaveLength(5000);
    expect(new Set(all.map((n) => n.id)).size).toBe(5000);
  });

  it('runs a per-project watcher on demand and broadcasts graph-changed over SSE', async () => {
    const root = await project('simple-project');
    const remote = await h.remote(root);
    await runIndex({ rootDir: root, graphStore: remote, config: TEST_CONFIG, fileIndexPath: join(root, '.flowlens', 'file_index.json'), incremental: false });
    const events: GraphChangedEvent[] = [];
    await remote.watch(50, (e) => events.push(e));
    expect(h.daemon.deps.pool.state(remote.projectId as string).watching).toBe(true);
    await sleep(200);
    await writeFile(join(root, 'added.ts'), 'export function addedLater(): number { return 1; }\n');
    for (let i = 0; i < 100 && events.length === 0; i++) await sleep(50);
    expect(events[0]).toMatchObject({ type: 'graph-changed', source: 'watch', files_reparsed: 1 });
    expect(events[0].paths).toContain('added.ts');
    expect((await remote.getNodesByFile('added.ts')).some((n) => n.name === 'addedLater')).toBe(true);
    await remote.close();
    for (let i = 0; i < 20 && h.daemon.deps.watchers.isWatching(remote.projectId as string); i++) await sleep(25);
    expect(h.daemon.deps.watchers.isWatching(remote.projectId as string)).toBe(false);
  }, 20_000);

  it('evicts a project on /close and shuts down cleanly (DBs closed, daemon.json removed)', async () => {
    const root = await project('simple-project');
    const remote = await h.remote(root);
    await remote.putNode({ id: 'k', kind: 'function', name: 'k' } as Entity);
    const c = h.client();
    await c.request('POST', `/api/projects/${remote.projectId}/close`, {});
    expect(h.daemon.deps.pool.state(remote.projectId as string)).toMatchObject({ open: false, leases: 0 });
    expect((await remote.getNode('k'))?.name).toBe('k'); // transparently reopened
    await c.request('POST', '/api/shutdown', {});
    for (let i = 0; i < 40 && existsSync(daemonInfoPath()); i++) await sleep(25);
    expect(existsSync(daemonInfoPath())).toBe(false);
    const direct = new LevelGraphStore();
    await direct.open(join(root, '.flowlens', 'graph')); // lock released
    await direct.close();
    c.destroy();
  });
});
