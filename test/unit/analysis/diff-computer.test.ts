import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { computeDiff } from '../../../src/analysis/diff-computer.js';
import type { Entity, Visibility } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';
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

function makeRelation(
  id: string,
  from: string,
  to: string,
  type: RelationType = 'import',
): Relation {
  return {
    id,
    from,
    to,
    type,
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

  /* ---------- parameter_added ---------- */

  it('detects parameter_added when function gains a parameter', async () => {
    // Current: function foo(a, b) — snapshot: function foo(a)
    const func = makeEntity('f1', 'foo', 'src/a.ts', {
      kind: 'function',
      qualified_name: 'src/a.ts/foo',
    });
    const paramA = makeEntity('p1', 'a', 'src/a.ts', {
      kind: 'parameter',
      qualified_name: 'src/a.ts/foo.a',
    });
    const paramB = makeEntity('p2', 'b', 'src/a.ts', {
      kind: 'parameter',
      qualified_name: 'src/a.ts/foo.b',
    });

    await store.putNodes([func, paramA, paramB]);

    const snapshot = makeSnapshot([func, paramA]); // no paramB in snapshot

    const diff = await computeDiff(store, snapshot);

    const added = diff.changes.filter(c => c.change_type === 'parameter_added');
    expect(added).toHaveLength(1);
    expect(added[0].entity_name).toBe('foo');
    expect(added[0].severity).toBe('breaking');
    expect(added[0].details).toContain("'b'");
  });

  /* ---------- parameter_removed ---------- */

  it('detects parameter_removed when function loses a parameter', async () => {
    // Current: function foo(a) — snapshot: function foo(a, b)
    const func = makeEntity('f1', 'foo', 'src/a.ts', {
      kind: 'function',
      qualified_name: 'src/a.ts/foo',
    });
    const paramA = makeEntity('p1', 'a', 'src/a.ts', {
      kind: 'parameter',
      qualified_name: 'src/a.ts/foo.a',
    });
    const paramB = makeEntity('p2', 'b', 'src/a.ts', {
      kind: 'parameter',
      qualified_name: 'src/a.ts/foo.b',
    });

    await store.putNodes([func, paramA]); // current has only paramA

    const snapshot = makeSnapshot([func, paramA, paramB]); // snapshot has both

    const diff = await computeDiff(store, snapshot);

    const removed = diff.changes.filter(c => c.change_type === 'parameter_removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].entity_name).toBe('foo');
    expect(removed[0].severity).toBe('breaking');
    expect(removed[0].details).toContain("'b'");
  });

  /* ---------- return_changed ---------- */

  it('detects return_changed when return relations differ', async () => {
    const func = makeEntity('f1', 'foo', 'src/a.ts', {
      kind: 'function',
      qualified_name: 'src/a.ts/foo',
    });
    const typeA = makeEntity('t1', 'TypeA', 'src/types.ts', {
      kind: 'type',
      qualified_name: 'src/types.ts/TypeA',
    });
    const typeB = makeEntity('t2', 'TypeB', 'src/types.ts', {
      kind: 'type',
      qualified_name: 'src/types.ts/TypeB',
    });

    // Current graph: foo returns TypeB
    await store.putNodes([func, typeA, typeB]);
    await store.putEdges([
      makeRelation('ret1', 'f1', 't2', 'return'),
    ]);

    // Snapshot: foo returned TypeA
    const snapshot = makeSnapshot(
      [func, typeA, typeB],
      [makeRelation('ret0', 'f1', 't1', 'return')],
    );

    const diff = await computeDiff(store, snapshot);

    const returnChanges = diff.changes.filter(c => c.change_type === 'return_changed');
    expect(returnChanges).toHaveLength(1);
    expect(returnChanges[0].entity_name).toBe('foo');
    expect(returnChanges[0].severity).toBe('breaking');
  });

  /* ---------- type_changed ---------- */

  it('detects type_changed for modified type alias', async () => {
    // Snapshot: type Foo spans lines 1-3; Current: type Foo spans lines 1-10
    const oldType = makeEntity('t1', 'Foo', 'src/types.ts', {
      kind: 'type',
      qualified_name: 'src/types.ts/Foo',
      location: { line_start: 1, line_end: 3, column_start: 0, column_end: 0 },
    });
    const currType = makeEntity('t1', 'Foo', 'src/types.ts', {
      kind: 'type',
      qualified_name: 'src/types.ts/Foo',
      location: { line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
    });

    await store.putNodes([currType]);

    const snapshot = makeSnapshot([oldType]);

    const diff = await computeDiff(store, snapshot);

    const typeChanges = diff.changes.filter(c => c.change_type === 'type_changed');
    expect(typeChanges).toHaveLength(1);
    expect(typeChanges[0].entity_name).toBe('Foo');
    expect(typeChanges[0].severity).toBe('breaking');
    expect(typeChanges[0].details).toContain('definition changed');
  });

  /* ---------- modified (catch-all) ---------- */

  it('detects modified for significant structural change', async () => {
    // Snapshot: class Foo has 10 lines; Current: class Foo has 50 lines (>50% change)
    const oldClass = makeEntity('c1', 'Foo', 'src/foo.ts', {
      kind: 'class',
      qualified_name: 'src/foo.ts/Foo',
      metrics: { line_count: 10 },
    });
    const currClass = makeEntity('c1', 'Foo', 'src/foo.ts', {
      kind: 'class',
      qualified_name: 'src/foo.ts/Foo',
      metrics: { line_count: 50 },
    });

    await store.putNodes([currClass]);

    const snapshot = makeSnapshot([oldClass]);

    const diff = await computeDiff(store, snapshot);

    const modified = diff.changes.filter(c => c.change_type === 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0].entity_name).toBe('Foo');
    expect(modified[0].severity).toBe('non-breaking');
    expect(modified[0].details).toContain('10');
    expect(modified[0].details).toContain('50');
  });

  it('does not flag modified for small line count changes', async () => {
    // 10 lines → 12 lines is only a 20% change — should not be flagged
    const oldClass = makeEntity('c1', 'Bar', 'src/bar.ts', {
      kind: 'class',
      qualified_name: 'src/bar.ts/Bar',
      metrics: { line_count: 10 },
    });
    const currClass = makeEntity('c1', 'Bar', 'src/bar.ts', {
      kind: 'class',
      qualified_name: 'src/bar.ts/Bar',
      metrics: { line_count: 12 },
    });

    await store.putNodes([currClass]);

    const snapshot = makeSnapshot([oldClass]);

    const diff = await computeDiff(store, snapshot);

    const modified = diff.changes.filter(c => c.change_type === 'modified');
    expect(modified).toHaveLength(0);
  });
});
