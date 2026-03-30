import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { detectCycles } from '../../../src/analysis/cycle-detector.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------- helpers ---------- */

function makeFileEntity(
  id: string,
  file: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind: 'class',
    name: id,
    qualified_name: `${file}/${id}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 1 },
    visibility: 'public',
    language: 'typescript',
    ...overrides,
  };
}

function makeFuncEntity(
  id: string,
  file: string,
  overrides: Partial<Entity> = {},
): Entity {
  return makeFileEntity(id, file, { kind: 'function', ...overrides });
}

function makeImportEdge(
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
    location: { file: 'test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1.0,
  };
}

/* ---------- test suite ---------- */

describe('detectCycles', () => {
  let store: LevelGraphStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), 'flowlens-cycle-test-'));
    store = new LevelGraphStore();
    await store.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await rm(dbPath, { recursive: true, force: true });
  });

  it('detects simple 2-node cycle (A->B->A)', async () => {
    await store.putNodes([
      makeFileEntity('A', 'src/a.ts'),
      makeFileEntity('B', 'src/b.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'A', 'B'),
      makeImportEdge('r2', 'B', 'A'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].length).toBe(2);
    expect(cycles[0].entities.sort()).toEqual(['A', 'B']);
    expect(cycles[0].relation_types).toContain('import');
  });

  it('detects triangle cycle (A->B->C->A)', async () => {
    await store.putNodes([
      makeFileEntity('A', 'src/a.ts'),
      makeFileEntity('B', 'src/b.ts'),
      makeFileEntity('C', 'src/c.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'A', 'B'),
      makeImportEdge('r2', 'B', 'C'),
      makeImportEdge('r3', 'C', 'A'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].length).toBe(3);
    expect(cycles[0].entities.sort()).toEqual(['A', 'B', 'C']);
  });

  it('detects multiple independent cycles', async () => {
    // Cycle 1: A <-> B
    // Cycle 2: C -> D -> E -> C
    await store.putNodes([
      makeFileEntity('A', 'src/a.ts'),
      makeFileEntity('B', 'src/b.ts'),
      makeFileEntity('C', 'src/c.ts'),
      makeFileEntity('D', 'src/d.ts'),
      makeFileEntity('E', 'src/e.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'A', 'B'),
      makeImportEdge('r2', 'B', 'A'),
      makeImportEdge('r3', 'C', 'D'),
      makeImportEdge('r4', 'D', 'E'),
      makeImportEdge('r5', 'E', 'C'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(2);

    const lengths = cycles.map((c) => c.length).sort();
    expect(lengths).toEqual([2, 3]);
  });

  it('returns empty for acyclic graph', async () => {
    await store.putNodes([
      makeFileEntity('A', 'src/a.ts'),
      makeFileEntity('B', 'src/b.ts'),
      makeFileEntity('C', 'src/c.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'A', 'B'),
      makeImportEdge('r2', 'B', 'C'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(0);
  });

  it('file granularity collapses entities to files', async () => {
    // Two entities in file-a.ts, one in file-b.ts
    // Import edge from entity in file-a to entity in file-b,
    // and from entity in file-b back to entity in file-a
    await store.putNodes([
      makeFileEntity('class-a1', 'src/file-a.ts'),
      makeFileEntity('class-a2', 'src/file-a.ts', { name: 'A2' }),
      makeFileEntity('class-b1', 'src/file-b.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'class-a1', 'class-b1'),
      makeImportEdge('r2', 'class-b1', 'class-a2'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'file' });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entities.sort()).toEqual(['src/file-a.ts', 'src/file-b.ts']);
    expect(cycles[0].length).toBe(2);
  });

  it('module granularity collapses to directories', async () => {
    // Entity in routes/ imports entity in services/,
    // entity in services/ imports entity in routes/ => cycle
    await store.putNodes([
      makeFileEntity('routeA', 'routes/index.ts'),
      makeFileEntity('serviceB', 'services/api.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'routeA', 'serviceB'),
      makeImportEdge('r2', 'serviceB', 'routeA'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'module' });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entities.sort()).toEqual(['routes', 'services']);
  });

  it('function granularity uses only call edges', async () => {
    // Two functions forming a call cycle
    await store.putNodes([
      makeFuncEntity('funcA', 'src/utils.ts'),
      makeFuncEntity('funcB', 'src/helpers.ts'),
    ]);
    // An import edge (should be ignored for function granularity)
    await store.putEdges([
      makeImportEdge('r-import', 'funcA', 'funcB', 'import'),
    ]);

    // No call edges — should find no cycle
    let cycles = await detectCycles(store, { granularity: 'function' });
    expect(cycles).toHaveLength(0);

    // Now add call edges forming a cycle
    await store.putEdges([
      makeImportEdge('r-call1', 'funcA', 'funcB', 'call'),
      makeImportEdge('r-call2', 'funcB', 'funcA', 'call'),
    ]);

    cycles = await detectCycles(store, { granularity: 'function' });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entities.sort()).toEqual(['funcA', 'funcB']);
    expect(cycles[0].relation_types).toEqual(['call']);
  });

  it('severity: short cycle = higher severity than long cycle', async () => {
    // 2-node cycle (higher severity due to shorter length)
    await store.putNodes([
      makeFileEntity('S1', 'dir1/s1.ts'),
      makeFileEntity('S2', 'dir2/s2.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('rs1', 'S1', 'S2'),
      makeImportEdge('rs2', 'S2', 'S1'),
    ]);

    // 5-node cycle (lower severity due to longer length)
    await store.putNodes([
      makeFileEntity('L1', 'src/l1.ts'),
      makeFileEntity('L2', 'src/l2.ts'),
      makeFileEntity('L3', 'src/l3.ts'),
      makeFileEntity('L4', 'src/l4.ts'),
      makeFileEntity('L5', 'src/l5.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('rl1', 'L1', 'L2'),
      makeImportEdge('rl2', 'L2', 'L3'),
      makeImportEdge('rl3', 'L3', 'L4'),
      makeImportEdge('rl4', 'L4', 'L5'),
      makeImportEdge('rl5', 'L5', 'L1'),
    ]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles.length).toBe(2);

    const shortCycle = cycles.find((c) => c.length === 2)!;
    const longCycle = cycles.find((c) => c.length === 5)!;

    const severityOrder = { low: 0, medium: 1, high: 2 };
    expect(severityOrder[shortCycle.severity]).toBeGreaterThanOrEqual(
      severityOrder[longCycle.severity],
    );
  });

  it('filters by severity_threshold', async () => {
    // Cross-boundary 2-node cycle (high severity: short + cross-boundary)
    await store.putNodes([
      makeFileEntity('HA', 'alpha/ha.ts', {
        metrics: { line_count: 10, afferent_coupling: 5 },
      }),
      makeFileEntity('HB', 'beta/hb.ts', {
        metrics: { line_count: 10, afferent_coupling: 5 },
      }),
    ]);
    await store.putEdges([
      makeImportEdge('rh1', 'HA', 'HB'),
      makeImportEdge('rh2', 'HB', 'HA'),
    ]);

    // Same-directory 5-node cycle (low severity: long + same boundary)
    await store.putNodes([
      makeFileEntity('LA', 'same/la.ts'),
      makeFileEntity('LB', 'same/lb.ts'),
      makeFileEntity('LC', 'same/lc.ts'),
      makeFileEntity('LD', 'same/ld.ts'),
      makeFileEntity('LE', 'same/le.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('rl1', 'LA', 'LB'),
      makeImportEdge('rl2', 'LB', 'LC'),
      makeImportEdge('rl3', 'LC', 'LD'),
      makeImportEdge('rl4', 'LD', 'LE'),
      makeImportEdge('rl5', 'LE', 'LA'),
    ]);

    // No filter: both cycles
    const allCycles = await detectCycles(store, { granularity: 'all' });
    expect(allCycles).toHaveLength(2);

    // With high threshold: only the high severity cycle
    const highOnly = await detectCycles(store, {
      granularity: 'all',
      severity_threshold: 'high',
    });
    expect(highOnly.length).toBeGreaterThanOrEqual(1);
    for (const c of highOnly) {
      expect(c.severity).toBe('high');
    }
  });

  it('cycle id is deterministic', async () => {
    await store.putNodes([
      makeFileEntity('X', 'src/x.ts'),
      makeFileEntity('Y', 'src/y.ts'),
    ]);
    await store.putEdges([
      makeImportEdge('r1', 'X', 'Y'),
      makeImportEdge('r2', 'Y', 'X'),
    ]);

    const run1 = await detectCycles(store, { granularity: 'all' });
    const run2 = await detectCycles(store, { granularity: 'all' });

    expect(run1).toHaveLength(1);
    expect(run2).toHaveLength(1);
    expect(run1[0].id).toBe(run2[0].id);
    // ID should be a sha256 hash (hex string)
    expect(run1[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores self-loops', async () => {
    await store.putNodes([makeFileEntity('Solo', 'src/solo.ts')]);
    await store.putEdges([makeImportEdge('r-self', 'Solo', 'Solo')]);

    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(0);
  });

  it('handles empty graph', async () => {
    const cycles = await detectCycles(store, { granularity: 'all' });
    expect(cycles).toHaveLength(0);
  });

  it('relation_types filter restricts which edges are considered', async () => {
    await store.putNodes([
      makeFileEntity('A', 'src/a.ts'),
      makeFileEntity('B', 'src/b.ts'),
    ]);
    // A calls B, B imports A — only a cycle if both edge types are considered
    await store.putEdges([
      makeImportEdge('r1', 'A', 'B', 'call'),
      makeImportEdge('r2', 'B', 'A', 'import'),
    ]);

    // Filter to only 'call' edges — no cycle (only one direction)
    const callOnly = await detectCycles(store, {
      granularity: 'all',
      relation_types: ['call'],
    });
    expect(callOnly).toHaveLength(0);

    // Filter to both types — cycle detected
    const both = await detectCycles(store, {
      granularity: 'all',
      relation_types: ['call', 'import'],
    });
    expect(both).toHaveLength(1);
  });
});
