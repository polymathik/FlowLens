import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleTraverse } from '../../../../src/mcp/tools/traverse.js';
import type { ServerDependencies } from '../../../../src/mcp/server.js';
import { LevelGraphStore } from '../../../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../../../src/analysis/snapshot-manager.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entity } from '../../../../src/contracts/entities.js';
import type { Relation } from '../../../../src/contracts/relations.js';

/* ---- helpers ---- */

function makeEntity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  const file = overrides.file ?? 'src/test.ts';
  return {
    kind: 'class',
    qualified_name: `${file}/${overrides.name}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    ...overrides,
  };
}

function makeRelation(
  id: string,
  from: string,
  to: string,
  type: Relation['type'] = 'call',
): Relation {
  return {
    id,
    from,
    to,
    type,
    location: { file: 'src/test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

/* ---- test suite ---- */

describe('traverse tool', () => {
  let store: LevelGraphStore;
  let annotationStore: AnnotationStore;
  let tmpDir: string;
  let deps: ServerDependencies;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-traverse-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));

    annotationStore = new AnnotationStore(join(tmpDir, 'annotations.json'));
    await annotationStore.load();

    deps = {
      graph: store,
      annotationStore,
      snapshotManager: new SnapshotManager(join(tmpDir, 'snapshots')),
      flowlensDir: tmpDir,
      rootDir: tmpDir,
      fileIndexPath: join(tmpDir, 'file_index.json'),
    };
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('traverses outbound at depth 1', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'a', 'b', 'call'),
      makeRelation('r2', 'b', 'c', 'call'),
    ]);

    const result = await handleTraverse(
      { start: 'A', direction: 'outbound', max_depth: 1 },
      deps,
    );

    const parsed = parseResult(result);
    expect(parsed.data.start.name).toBe('A');
    expect(parsed.data.nodes).toHaveLength(1);
    expect(parsed.data.nodes[0].entity.name).toBe('B');
    expect(parsed.data.nodes[0].depth).toBe(1);
    // C should NOT be reached at depth 1
    const names = parsed.data.nodes.map((n: any) => n.entity.name);
    expect(names).not.toContain('C');
  });

  it('traverses inbound', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'b', 'a', 'call'),
      makeRelation('r2', 'c', 'a', 'import'),
    ]);

    const result = await handleTraverse(
      { start: 'A', direction: 'inbound', max_depth: 1 },
      deps,
    );

    const parsed = parseResult(result);
    expect(parsed.data.nodes).toHaveLength(2);
    const names = parsed.data.nodes.map((n: any) => n.entity.name).sort();
    expect(names).toEqual(['B', 'C']);
  });

  it('respects depth limiting', async () => {
    // Chain: A -> B -> C -> D
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
      makeEntity({ id: 'd', name: 'D' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'a', 'b', 'call'),
      makeRelation('r2', 'b', 'c', 'call'),
      makeRelation('r3', 'c', 'd', 'call'),
    ]);

    // Depth 2 should reach B and C but NOT D
    const result = await handleTraverse(
      { start: 'A', direction: 'outbound', max_depth: 2 },
      deps,
    );

    const parsed = parseResult(result);
    const names = parsed.data.nodes.map((n: any) => n.entity.name);
    expect(names).toContain('B');
    expect(names).toContain('C');
    expect(names).not.toContain('D');
  });

  it('caps at max_nodes', async () => {
    // Create a hub with many outbound connections
    const entities = [makeEntity({ id: 'hub', name: 'Hub' })];
    const relations: Relation[] = [];
    for (let i = 0; i < 20; i++) {
      entities.push(makeEntity({ id: `dep${i}`, name: `Dep${i}` }));
      relations.push(makeRelation(`r${i}`, 'hub', `dep${i}`, 'call'));
    }

    await store.putNodes(entities);
    await store.putEdges(relations);

    const result = await handleTraverse(
      { start: 'Hub', direction: 'outbound', max_depth: 1, max_nodes: 5 },
      deps,
    );

    const parsed = parseResult(result);
    expect(parsed.data.nodes.length).toBeLessThanOrEqual(5);
  });

  it('stops at architecture layer boundary', async () => {
    // Entity in "api" layer calls entity in "data" layer
    await store.putNodes([
      makeEntity({ id: 'handler', name: 'Handler', file: 'src/api/handler.ts' }),
      makeEntity({ id: 'service', name: 'Service', file: 'src/api/service.ts' }),
      makeEntity({ id: 'repo', name: 'Repository', file: 'src/data/repo.ts' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'handler', 'service', 'call'),
      makeRelation('r2', 'service', 'repo', 'call'),
    ]);

    // Write architecture.json with two layers
    const archConfig = {
      version: 2,
      inferred_by: 'manual',
      inferred_at: new Date().toISOString(),
      layers: [
        {
          name: 'api',
          include: { patterns: ['src/api/**'] },
          may_only_access: ['data'],
        },
        {
          name: 'data',
          include: { patterns: ['src/data/**'] },
        },
      ],
    };
    await writeFile(
      join(tmpDir, 'architecture.json'),
      JSON.stringify(archConfig),
    );

    const result = await handleTraverse(
      { start: 'Handler', direction: 'outbound', max_depth: 3, stop_at_boundary: true },
      deps,
    );

    const parsed = parseResult(result);
    // Service should be reached (same layer)
    const nodeNames = parsed.data.nodes.map((n: any) => n.entity.name);
    expect(nodeNames).toContain('Service');
    // Repository is in a different layer — reported in stopped_at_boundaries
    // with the layers crossed (contract revision 2).
    expect(parsed.data.stopped_at_boundaries).toEqual([
      { entity: 'src/data/repo.ts/Repository', from_layer: 'api', to_layer: 'data' },
    ]);
    // Repository is returned as a boundary node but not expanded further.
    const repo = parsed.data.nodes.find((n: any) => n.entity.name === 'Repository');
    expect(repo.boundary).toBe(true);
    expect(repo.layer).toBe('data');
  });

  it('filters by relation_types', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'a', 'b', 'call'),
      makeRelation('r2', 'a', 'c', 'import'),
    ]);

    const result = await handleTraverse(
      { start: 'A', direction: 'outbound', relation_types: ['call'] },
      deps,
    );

    const parsed = parseResult(result);
    expect(parsed.data.nodes).toHaveLength(1);
    expect(parsed.data.nodes[0].entity.name).toBe('B');
  });

  it('traverses both directions', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'a', 'b', 'call'),   // A -> B (outbound from A)
      makeRelation('r2', 'c', 'b', 'import'),  // C -> B (inbound to B from C)
    ]);

    const result = await handleTraverse(
      { start: 'B', direction: 'both', max_depth: 1 },
      deps,
    );

    const parsed = parseResult(result);
    const names = parsed.data.nodes.map((n: any) => n.entity.name).sort();
    // From B outbound: nothing; inbound to B: A and C
    expect(names).toContain('A');
    expect(names).toContain('C');
  });

  it('returns error for unknown entity', async () => {
    const result = await handleTraverse(
      { start: 'NonExistent', direction: 'outbound' },
      deps,
    );

    expect(result).toHaveProperty('isError', true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not found');
  });
});
