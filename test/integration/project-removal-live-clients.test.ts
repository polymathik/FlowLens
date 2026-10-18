/**
 * Phase 12 review M1 + L1: removing a project that live clients use, and
 * the client's recovery behaviour.
 *
 * - DELETE /api/projects/:id refuses (409 project_in_use) while clients
 *   hold leases, unless ?force=1.
 * - After a forced removal a live RemoteGraphStore re-registers the project
 *   on its next call and keeps working (it used to fail every call with
 *   not_found until restarted).
 * - Recovery releases the old lease first (no stale lease pinning the DB).
 * - Every RPC has a timeout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RemoteServiceError } from '../../src/service/errors.js';
import { DaemonClient } from '../../src/service/client.js';
import { RemoteGraphStore } from '../../src/service/remote-graph-store.js';
import type { RemoteSession } from '../../src/service/remote-session.js';
import { startHarness, type Harness } from '../helpers/daemon-harness.js';
import { removeDir, tempDir } from '../helpers/service-env.js';

async function makeProject(): Promise<string> {
  const root = await tempDir('flowlens-del-');
  await mkdir(join(root, 'src'));
  await mkdir(join(root, '.flowlens'));
  await writeFile(join(root, 'src/a.ts'), 'export function a() { return 1; }\n');
  return root;
}

describe('project removal with live clients (M1, L1)', () => {
  let h: Harness;
  let root: string;

  beforeEach(async () => {
    h = await startHarness();
    root = await makeProject();
  });
  afterEach(async () => {
    await h.stop();
    await removeDir(root);
  });

  it('DELETE answers 409 while leased, removes with ?force=1, and the live client re-attaches', async () => {
    const store = await h.remote(root, 'serve');
    await store.reindex({ full: true });
    const before = (await store.getAllNodes()).length;
    expect(before).toBeGreaterThan(0);
    const id = store.projectId!;
    const client = h.client();

    const refused = await client.request('DELETE', `/api/projects/${id}`).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RemoteServiceError);
    expect((refused as RemoteServiceError).status).toBe(409);
    expect((refused as RemoteServiceError).code).toBe('project_in_use');
    expect((refused as RemoteServiceError).message).toMatch(/in use by 1 client/);

    await client.request('DELETE', `/api/projects/${id}?force=1`);
    expect(await h.daemon.deps.registry.get(id)).toBeNull();

    expect((await store.getAllNodes()).length).toBe(before);
    expect(await h.daemon.deps.registry.get(store.projectId!)).not.toBeNull();
    expect(h.daemon.deps.pool.state(store.projectId!).leases).toBe(1);
    client.destroy();
  }, 30_000);

  it('recovering from a transient connection error releases the old lease first', async () => {
    const store = await h.remote(root, 'serve');
    const id = store.projectId!;
    expect(h.daemon.deps.pool.state(id).leases).toBe(1);
    const session = (store as unknown as { session: RemoteSession }).session;
    await session.recover(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    expect(h.daemon.deps.pool.state(id).leases).toBe(1);
    expect(await store.getNode('nope')).toBeNull();
  }, 30_000);

  it('a graph RPC that never answers times out', async () => {
    // A "daemon" that answers resolve/leases but hangs on RPC.
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/projects/resolve') return void res.end(JSON.stringify({ id: 'p1', name: 'p', root, status: 'ok' }));
      if (req.url?.endsWith('/leases')) return void res.end(JSON.stringify({ ok: true, lease_id: 'l', ttl_ms: 60_000, project_id: 'p1' }));
      if (req.method === 'DELETE') return void res.end('{"ok":true}');
      // RPC: never answer
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const info = { pid: process.pid, host: '127.0.0.1' as const, port, token: 't', version: 'x', started_at: '' };
    const store = new RemoteGraphStore(async () => new DaemonClient(info), 'test', { rpcTimeoutMs: 200 });
    try {
      await store.open(join(root, '.flowlens', 'graph'));
      const t = Date.now();
      await expect(store.getAllNodes()).rejects.toThrow(/timed out/);
      expect(Date.now() - t).toBeLessThan(3_000);
    } finally {
      await store.close();
      srv.closeAllConnections();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 30_000);
});
