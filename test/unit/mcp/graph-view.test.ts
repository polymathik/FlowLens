import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { getGraphView, invalidateGraphView, viewAsGraphStore } from '../../../src/mcp/graph-view.js';
import type { Entity } from '../../../src/contracts/entities.js';

const e = (id: string): Entity => ({
  id, kind: 'function', name: id, qualified_name: `a.ts/${id}`, file: 'a.ts',
  location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 }, visibility: 'public', language: 'typescript',
});

describe('GraphView cache', () => {
  let dir: string;
  let graph: LevelGraphStore;
  const src = () => ({ graph, flowlensDir: dir, fileIndexPath: join(dir, 'file_index.json') });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flowlens-gv-'));
    graph = new LevelGraphStore();
    await graph.open(join(dir, 'graph'));
    await graph.putNodes([e('a'), e('b')]);
  });

  afterEach(async () => {
    await graph.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('reuses the view while the graph is unchanged', async () => {
    const v1 = await getGraphView(src());
    const v2 = await getGraphView(src());
    expect(v2).toBe(v1);
    expect(v1.nodes).toHaveLength(2);
  });

  it('rebuilds after any write to the store', async () => {
    const v1 = await getGraphView(src());
    await graph.putNode(e('c'));
    const v2 = await getGraphView(src());
    expect(v2).not.toBe(v1);
    expect(v2.byId.has('c')).toBe(true);
  });

  it('can be invalidated explicitly and via a version token', async () => {
    const v1 = await getGraphView(src());
    invalidateGraphView(graph);
    expect(await getGraphView(src())).not.toBe(v1);

    let version = '1';
    const versioned = { ...src(), graphVersion: () => version };
    const a = await getGraphView(versioned);
    expect(await getGraphView(versioned)).toBe(a);
    version = '2';
    expect(await getGraphView(versioned)).not.toBe(a);
  });

  it('store facade is read-only and mirrors the view', async () => {
    const view = await getGraphView(src());
    const facade = viewAsGraphStore(view);
    expect((await facade.getAllNodes()).length).toBe(2);
    await expect(facade.putNode(e('z'))).rejects.toThrow(/read-only/);
  });
});
