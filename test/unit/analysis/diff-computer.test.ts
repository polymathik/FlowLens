import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { computeDiff } from '../../../src/analysis/diff-computer.js';
import type { Entity, Visibility } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';
import type { SnapshotData } from '../../../src/contracts/analysis/snapshots.js';

/* ---------- helpers ---------- */

function makeEntity(
  id: string,
  name: string,
  file: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind: 'function',
    name,
    qualified_name: `${file}/${name}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
    metrics: { line_count: 10 },
    ...overrides,
  };
}

function makeRelation(id: string, from: string, to: string): Relation {
  return {
    id,
    from,
    to,
    type: 'import',
    location: { file: 'src/test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1.0,
  };
}

function makeSnapshot(entities: Entity[], relations: Relation[] = [], sha = 'old-sha'): SnapshotData {
  return {
    sha,
    timestamp: new Date().toISOString(),
    entities,
    relations,
  };
}

/* ---------- test suite ---------- */

describe('DiffComputer', () => {
  let store: LevelGraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-diff-test-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('detects added entities as non-breaking', async () => {
    // Current graph has an extra entity not in snapshot
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ]);

    const snapshot = makeSnapshot([makeEntity('e1', 'funcA', 'src/a.ts')]);
    const diff = await computeDiff(store, snapshot);

    const added = diff.changes.filter(c => c.change_type === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].entity_name).toBe('funcB');
    expect(added[0].severity).toBe('non-breaking');
    expect(added[0].affected_dependents).toBe(0);
  });

  it('detects removed entities as breaking', async () => {
    // Current graph is missing an entity that was in snapshot
    await store.putNodes([makeEntity('e1', 'funcA', 'src/a.ts')]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ]);

    const diff = await computeDiff(store, snapshot);

    const removed = diff.changes.filter(c => c.change_type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].entity_name).toBe('funcB');
    expect(removed[0].severity).toBe('breaking');
  });

  it('detects visibility reduction as breaking', async () => {
    // Entity goes from public -> private (reduction)
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'private' }),
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'public' }),
    ]);

    const diff = await computeDiff(store, snapshot);

    const visChanges = diff.changes.filter(c => c.change_type === 'visibility');
    expect(visChanges).toHaveLength(1);
    expect(visChanges[0].severity).toBe('breaking');
    expect(visChanges[0].details).toContain('public');
    expect(visChanges[0].details).toContain('private');
  });

  it('detects visibility expansion as non-breaking', async () => {
    // Entity goes from private -> public (expansion)
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'public' }),
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'private' }),
    ]);

    const diff = await computeDiff(store, snapshot);

    const visChanges = diff.changes.filter(c => c.change_type === 'visibility');
    expect(visChanges).toHaveLength(1);
    expect(visChanges[0].severity).toBe('non-breaking');
  });

  it('returns empty diff for identical states', async () => {
    const entities = [
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'),
    ];
    await store.putNodes(entities);

    const snapshot = makeSnapshot(entities);
    const diff = await computeDiff(store, snapshot);

    expect(diff.changes).toHaveLength(0);
    expect(diff.summary.total_changes).toBe(0);
    expect(diff.summary.breaking_changes).toBe(0);
    expect(diff.summary.non_breaking_changes).toBe(0);
  });

  it('breaking_only filter hides non-breaking changes', async () => {
    // Mix of added (non-breaking) and removed (breaking)
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e3', 'funcC', 'src/c.ts'), // added
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'), // removed -> breaking
    ]);

    const diff = await computeDiff(store, snapshot, { breaking_only: true });

    expect(diff.changes.every(c => c.severity === 'breaking')).toBe(true);
    // The added entity (non-breaking) should be filtered out
    expect(diff.changes.find(c => c.entity_name === 'funcC')).toBeUndefined();
    // The removed entity (breaking) should still be present
    expect(diff.changes.find(c => c.entity_name === 'funcB')).toBeDefined();
  });

  it('counts affected dependents for removed entities', async () => {
    // e1 and e3 both depend on e2; remove e2 from current to make it "removed" from snapshot perspective
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e3', 'funcC', 'src/c.ts'),
    ]);
    // e1 and e3 both had edges TO e2 (which is now removed)
    // Since e2 is no longer in current graph, edges to it won't exist in current graph.
    // The dependents count is based on current graph's edges to the removed entity's id.
    // Since e2 is gone, its dependents count will be 0.
    // To test dependent counting properly, we test visibility reduction where entity still exists:
    await store.putEdges([makeRelation('r1', 'e1', 'e3'), makeRelation('r2', 'e3', 'e1')]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e3', 'funcC', 'src/c.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'), // removed
    ]);

    const diff = await computeDiff(store, snapshot);
    const removed = diff.changes.find(c => c.entity_name === 'funcB');
    expect(removed).toBeDefined();
    // e2 is not in current graph, so no edges TO it — 0 dependents
    expect(removed!.affected_dependents).toBe(0);
  });

  it('counts affected dependents for visibility-reduced entities', async () => {
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'private' }),
      makeEntity('e2', 'callerX', 'src/x.ts'),
      makeEntity('e3', 'callerY', 'src/y.ts'),
    ]);
    // Two callers depend on funcA
    await store.putEdges([
      makeRelation('r1', 'e2', 'e1'),
      makeRelation('r2', 'e3', 'e1'),
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'public' }),
      makeEntity('e2', 'callerX', 'src/x.ts'),
      makeEntity('e3', 'callerY', 'src/y.ts'),
    ]);

    const diff = await computeDiff(store, snapshot);

    const visChange = diff.changes.find(c => c.change_type === 'visibility' && c.entity_name === 'funcA');
    expect(visChange).toBeDefined();
    expect(visChange!.severity).toBe('breaking');
    expect(visChange!.affected_dependents).toBe(2);
  });

  it('computes summary statistics', async () => {
    // 1 added (non-breaking) + 1 removed (breaking) + 1 visibility reduction (breaking)
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e3', 'funcC', 'src/c.ts', { visibility: 'private' }), // visibility reduced
      makeEntity('e4', 'funcD', 'src/d.ts'), // new, not in snapshot
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'), // removed -> breaking
      makeEntity('e3', 'funcC', 'src/c.ts', { visibility: 'public' }), // will reduce -> breaking
    ]);

    const diff = await computeDiff(store, snapshot);

    expect(diff.summary.total_changes).toBe(3);
    expect(diff.summary.breaking_changes).toBe(2);
    expect(diff.summary.non_breaking_changes).toBe(1);
    expect(diff.from_sha).toBe('old-sha');
    expect(diff.to_sha).toBe('current');
  });

  it('most_impacted_entity is the one with most affected dependents', async () => {
    // funcA has 2 dependents, funcC has 0 dependents
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'private' }),
      makeEntity('e3', 'funcC', 'src/c.ts', { visibility: 'private' }),
      makeEntity('e2', 'dep1', 'src/dep1.ts'),
      makeEntity('e4', 'dep2', 'src/dep2.ts'),
    ]);
    await store.putEdges([
      makeRelation('r1', 'e2', 'e1'),
      makeRelation('r2', 'e4', 'e1'),
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts', { visibility: 'public' }),
      makeEntity('e3', 'funcC', 'src/c.ts', { visibility: 'public' }),
      makeEntity('e2', 'dep1', 'src/dep1.ts'),
      makeEntity('e4', 'dep2', 'src/dep2.ts'),
    ]);

    const diff = await computeDiff(store, snapshot);
    expect(diff.summary.most_impacted_entity).toBe('funcA');
  });

  it('scope filter restricts changes to matching file paths', async () => {
    await store.putNodes([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e3', 'funcC', 'lib/c.ts'), // different scope
    ]);

    const snapshot = makeSnapshot([
      makeEntity('e1', 'funcA', 'src/a.ts'),
      makeEntity('e2', 'funcB', 'src/b.ts'), // removed in src/
      makeEntity('e3', 'funcC', 'lib/c.ts'),
      makeEntity('e4', 'funcD', 'lib/d.ts'), // removed in lib/
    ]);

    const diff = await computeDiff(store, snapshot, { scope: 'src' });

    // Only changes in src/ should appear
    for (const change of diff.changes) {
      const file = change.before?.file ?? change.after?.file ?? '';
      expect(file.startsWith('src')).toBe(true);
    }
  });
});
