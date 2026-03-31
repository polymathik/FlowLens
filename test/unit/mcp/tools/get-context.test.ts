import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleGetContext } from '../../../../src/mcp/tools/get-context.js';
import type { ServerDependencies } from '../../../../src/mcp/server.js';
import { LevelGraphStore } from '../../../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../../../src/analysis/snapshot-manager.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entity } from '../../../../src/contracts/entities.js';
import type { Relation } from '../../../../src/contracts/relations.js';

/* ---- helpers ---- */

function makeEntity(overrides: Partial<Entity> & { id: string; name: string }): Entity {
  return {
    kind: 'class',
    qualified_name: `src/test.ts/${overrides.name}`,
    file: 'src/test.ts',
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

/* ---- test suite ---- */

describe('get_context tool', () => {
  let store: LevelGraphStore;
  let annotationStore: AnnotationStore;
  let tmpDir: string;
  let deps: ServerDependencies;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-ctx-'));
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

  it('returns entity with relations', async () => {
    await store.putNodes([
      makeEntity({ id: 'e1', name: 'UserService' }),
      makeEntity({ id: 'e2', name: 'AuthService' }),
      makeEntity({ id: 'e3', name: 'DbClient' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'e1', 'e2', 'call'),
      makeRelation('r2', 'e3', 'e1', 'import'),
    ]);

    const result = await handleGetContext({ entity: 'UserService' }, deps);

    expect(result).toHaveProperty('content');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.entity.name).toBe('UserService');
    expect(parsed.data.relations.length).toBe(2);

    const outbound = parsed.data.relations.filter(
      (r: { direction: string }) => r.direction === 'outbound',
    );
    const inbound = parsed.data.relations.filter(
      (r: { direction: string }) => r.direction === 'inbound',
    );
    expect(outbound.length).toBe(1);
    expect(inbound.length).toBe(1);
  });

  it('resolves entity not found and returns error with suggestions', async () => {
    await store.putNodes([
      makeEntity({ id: 'e1', name: 'UserService' }),
    ]);

    const result = await handleGetContext({ entity: 'NonExistent' }, deps);

    expect(result).toHaveProperty('isError', true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not found');
  });

  it('respects max_results truncation', async () => {
    // Create a hub entity with many connections
    const entities = [makeEntity({ id: 'hub', name: 'Hub' })];
    const relations: Relation[] = [];

    for (let i = 0; i < 10; i++) {
      entities.push(makeEntity({ id: `dep${i}`, name: `Dep${i}` }));
      relations.push(makeRelation(`r${i}`, `dep${i}`, 'hub', 'call'));
    }

    await store.putNodes(entities);
    await store.putEdges(relations);

    const result = await handleGetContext(
      { entity: 'Hub', max_results: 3 },
      deps,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.relations.length).toBeLessThanOrEqual(3);
    expect(parsed.truncated).toBeDefined();
  });

  it('includes metrics when include_metrics=true', async () => {
    await store.putNodes([
      makeEntity({
        id: 'e1',
        name: 'Service',
        metrics: { line_count: 42, cognitive_complexity: 5 },
      }),
    ]);

    const result = await handleGetContext(
      { entity: 'Service', include_metrics: true },
      deps,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.entity.metrics).toBeDefined();
    expect(parsed.data.entity.metrics.line_count).toBe(42);
  });

  it('strips metrics when include_metrics=false', async () => {
    await store.putNodes([
      makeEntity({
        id: 'e1',
        name: 'Service',
        metrics: { line_count: 42 },
      }),
    ]);

    const result = await handleGetContext(
      { entity: 'Service', include_metrics: false },
      deps,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.entity.metrics).toBeUndefined();
  });

  it('includes annotations for entity', async () => {
    await store.putNodes([
      makeEntity({ id: 'e1', name: 'Service' }),
    ]);

    annotationStore.add({
      entity_id: 'e1',
      text: 'Consider refactoring',
      category: 'todo',
      author: 'test',
    });

    const result = await handleGetContext({ entity: 'Service' }, deps);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.annotations.length).toBe(1);
    expect(parsed.data.annotations[0].text).toBe('Consider refactoring');
  });

  it('filters by relation_types', async () => {
    await store.putNodes([
      makeEntity({ id: 'e1', name: 'UserService' }),
      makeEntity({ id: 'e2', name: 'AuthService' }),
      makeEntity({ id: 'e3', name: 'Logger' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'e1', 'e2', 'call'),
      makeRelation('r2', 'e1', 'e3', 'import'),
    ]);

    const result = await handleGetContext(
      { entity: 'UserService', relation_types: ['call'] },
      deps,
    );

    const parsed = JSON.parse(result.content[0].text);
    const relations = parsed.data.relations;
    expect(relations.length).toBe(1);
    expect(relations[0].relation.type).toBe('call');
  });

  it('traverses multiple depth levels', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
      makeEntity({ id: 'c', name: 'C' }),
    ]);
    await store.putEdges([
      makeRelation('r1', 'a', 'b', 'call'),
      makeRelation('r2', 'b', 'c', 'call'),
    ]);

    // Depth 1 — should only get B
    const result1 = await handleGetContext(
      { entity: 'A', depth: 1 },
      deps,
    );
    const parsed1 = JSON.parse(result1.content[0].text);
    const names1 = parsed1.data.relations.map(
      (r: { connected_entity: { name: string } }) => r.connected_entity.name,
    );
    expect(names1).toContain('B');
    expect(names1).not.toContain('C');

    // Depth 2 — should get B and C
    const result2 = await handleGetContext(
      { entity: 'A', depth: 2 },
      deps,
    );
    const parsed2 = JSON.parse(result2.content[0].text);
    const names2 = parsed2.data.relations.map(
      (r: { connected_entity: { name: string } }) => r.connected_entity.name,
    );
    expect(names2).toContain('B');
    expect(names2).toContain('C');
  });
});
