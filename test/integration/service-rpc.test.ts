/**
 * Graph RPC round trip: every GraphStore method through the daemon must
 * return exactly what a direct LevelGraphStore returns for the same index.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import { runIndex } from '../../src/indexer/indexer.js';
import type { GraphStore } from '../../src/contracts/graph.js';
import type { Entity } from '../../src/contracts/entities.js';
import type { Relation } from '../../src/contracts/relations.js';
import { GRAPH_READ_METHODS, GRAPH_WRITE_METHODS } from '../../src/contracts/service.js';
import { RemoteServiceError } from '../../src/service/errors.js';
import { startHarness, TEST_CONFIG, type Harness } from '../helpers/daemon-harness.js';
import { copyFixture, removeDir, tempDir } from '../helpers/service-env.js';

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

async function indexInto(root: string, store: GraphStore): Promise<void> {
  await runIndex({
    rootDir: root, graphStore: store, config: TEST_CONFIG,
    fileIndexPath: join(root, '.flowlens', 'file_index.json'), incremental: false,
  });
}

describe('graph service RPC round trip', () => {
  let h: Harness;
  let root: string;
  let refDir: string;
  let remote: GraphStore;
  let direct: LevelGraphStore;

  beforeAll(async () => {
    h = await startHarness();
    root = await copyFixture('simple-project');
    mkdirSync(join(root, '.flowlens'), { recursive: true });
    remote = await h.remote(root);
    await indexInto(root, remote);
    refDir = await tempDir('flowlens-ref-');
    const refRoot = await copyFixture('simple-project', refDir);
    mkdirSync(join(refRoot, '.flowlens'), { recursive: true });
    direct = new LevelGraphStore();
    await direct.open(join(refRoot, '.flowlens', 'graph'));
    await indexInto(refRoot, direct);
  }, 60_000);

  afterAll(async () => {
    await direct.close();
    await h.stop();
    await removeDir(refDir);
  });

  it('covers every GraphStore method except open/close in the contract', () => {
    const covered = new Set<string>([...GRAPH_READ_METHODS, ...GRAPH_WRITE_METHODS]);
    const proto = Object.getOwnPropertyNames(LevelGraphStore.prototype)
      .filter((m) => m !== 'constructor' && !['open', 'close'].includes(m) && !m.startsWith('_'));
    for (const m of proto.filter((x) => covered.has(x) || /^(get|put|delete|clear)/.test(x))) {
      expect(covered.has(m), m).toBe(true);
    }
  });

  it('read methods return identical results', async () => {
    const nodes = byId(await remote.getAllNodes());
    expect(nodes.length).toBeGreaterThan(5);
    expect(nodes).toEqual(byId(await direct.getAllNodes()));
    expect(byId(await remote.getAllEdges())).toEqual(byId(await direct.getAllEdges()));
    const cls = nodes.find((n) => n.kind === 'class') as Entity;
    expect(await remote.getNode(cls.id)).toEqual(await direct.getNode(cls.id));
    expect(await remote.getNode('does-not-exist')).toBeNull();
    expect(byId(await remote.getNodesByKind('class'))).toEqual(byId(await direct.getNodesByKind('class')));
    expect(byId(await remote.getNodesByFile(cls.file_path))).toEqual(byId(await direct.getNodesByFile(cls.file_path)));
    const withEdges = (await direct.getAllEdges())[0] as Relation;
    expect(byId(await remote.getEdgesFrom(withEdges.source))).toEqual(byId(await direct.getEdgesFrom(withEdges.source)));
    expect(byId(await remote.getEdgesTo(withEdges.target))).toEqual(byId(await direct.getEdgesTo(withEdges.target)));
    expect(byId(await remote.getEdgesFrom(withEdges.source, withEdges.type)))
      .toEqual(byId(await direct.getEdgesFrom(withEdges.source, withEdges.type)));
    expect(byId(await remote.getEdgesTo(withEdges.target, withEdges.type)))
      .toEqual(byId(await direct.getEdgesTo(withEdges.target, withEdges.type)));
  });

  it('write methods have identical effects', async () => {
    const sample = (await direct.getAllNodes()).find((n) => n.kind === 'function') as Entity;
    const node: Entity = { ...sample, id: 'rpc-test-node', name: 'rpcTestNode' };
    const edge = { ...(await direct.getAllEdges())[0], id: 'rpc-test-edge', source: node.id } as Relation;
    for (const s of [remote, direct]) {
      await s.putNode(node);
      await s.putEdge(edge);
      await s.putNodes([{ ...node, id: 'rpc-n2' }, { ...node, id: 'rpc-n3' }]);
      await s.putEdges([{ ...edge, id: 'rpc-e2' }]);
    }
    expect(await remote.getNode(node.id)).toEqual(node);
    expect(byId(await remote.getEdgesFrom(node.id))).toEqual(byId(await direct.getEdgesFrom(node.id)));
    for (const s of [remote, direct]) {
      await s.deleteEdge('rpc-test-edge');
      await s.deleteNode('rpc-n3');
    }
    expect(byId(await remote.getEdgesFrom(node.id))).toEqual(byId(await direct.getEdgesFrom(node.id)));
    expect(await remote.getNode('rpc-n3')).toBeNull();
    for (const s of [remote, direct]) {
      await s.deleteEdgesByFile(sample.file_path);
      await s.deleteNodesByFile(sample.file_path);
    }
    expect(byId(await remote.getAllNodes())).toEqual(byId(await direct.getAllNodes()));
    expect(byId(await remote.getAllEdges())).toEqual(byId(await direct.getAllEdges()));
    await remote.clear();
    expect(await remote.getAllNodes()).toEqual([]);
  });

  it('the Express RPC route (for embedders) matches the raw fast path', async () => {
    const { createServer } = await import('node:http');
    const server = createServer(h.daemon.app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { DaemonClient } = await import('../../src/service/client.js');
    const port = (server.address() as { port: number }).port;
    const viaExpress = new DaemonClient({ ...h.daemon.info, port });
    const id = (remote as unknown as { projectId: string }).projectId;
    await remote.putNodes([{ id: 'parity-1', kind: 'file', name: 'p1', file_path: 'p1.ts' } as Entity]);
    const body = { method: 'getNodesByKind', args: ['file'] };
    const a = await viaExpress.request<{ result: Entity[] }>('POST', `/api/projects/${id}/rpc`, body);
    const fast = h.client();
    const b = await fast.request<{ result: Entity[] }>('POST', `/api/projects/${id}/rpc`, body);
    expect(a.result.map((n) => n.id)).toContain('parity-1');
    expect(byId(a.result)).toEqual(byId(b.result));
    viaExpress.destroy();
    fast.destroy();
    server.close();
  });

  it('rejects unknown methods and missing projects with typed errors', async () => {
    const c = h.client();
    await expect(c.request('POST', '/api/projects/nope/rpc', { method: 'getAllNodes', args: [] }))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    const projects = await c.request<Array<{ id: string }>>('GET', '/api/projects');
    await expect(c.request('POST', `/api/projects/${projects[0].id}/rpc`, { method: 'open', args: ['/etc'] }))
      .rejects.toBeInstanceOf(RemoteServiceError);
    c.destroy();
  });
});
