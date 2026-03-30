import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computePageRank } from '../../../src/analysis/pagerank.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Helper entities and relations (same pattern as other tests)
function makeEntity(id: string, file = 'test.ts') {
  return {
    id,
    kind: 'class',
    name: id,
    qualified_name: `${file}/${id}`,
    file,
    location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
  } as any;
}

function makeEdge(id: string, from: string, to: string) {
  return {
    id,
    from,
    to,
    type: 'import',
    location: { file: 'test.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1,
  } as any;
}

describe('PageRank', () => {
  let store: LevelGraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-pr-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty map for empty graph', async () => {
    const ranks = await computePageRank(store);
    expect(ranks.size).toBe(0);
  });

  it('assigns equal ranks for disconnected nodes', async () => {
    await store.putNodes([makeEntity('A'), makeEntity('B'), makeEntity('C')]);
    const ranks = await computePageRank(store);
    const values = [...ranks.values()];
    // All should be approximately equal
    expect(Math.abs(values[0] - values[1])).toBeLessThan(0.01);
  });

  it('gives higher rank to nodes with more incoming edges', async () => {
    await store.putNodes([makeEntity('A'), makeEntity('B'), makeEntity('C')]);
    // A→C, B→C: C has 2 incoming, A and B have 0
    await store.putEdges([makeEdge('e1', 'A', 'C'), makeEdge('e2', 'B', 'C')]);
    const ranks = await computePageRank(store);
    expect(ranks.get('C')!).toBeGreaterThan(ranks.get('A')!);
    expect(ranks.get('C')!).toBeGreaterThan(ranks.get('B')!);
  });

  it('converges within max_iterations', async () => {
    await store.putNodes([makeEntity('A'), makeEntity('B')]);
    await store.putEdge(makeEdge('e1', 'A', 'B'));
    const ranks = await computePageRank(store, { max_iterations: 5 });
    expect(ranks.size).toBe(2);
  });

  it('respects damping factor', async () => {
    await store.putNodes([makeEntity('A'), makeEntity('B')]);
    await store.putEdge(makeEdge('e1', 'A', 'B'));
    const ranks1 = await computePageRank(store, { damping_factor: 0.5 });
    const ranks2 = await computePageRank(store, { damping_factor: 0.99 });
    // Higher damping → more difference between linked and unlinked nodes
    const diff1 = Math.abs(ranks1.get('B')! - ranks1.get('A')!);
    const diff2 = Math.abs(ranks2.get('B')! - ranks2.get('A')!);
    expect(diff2).toBeGreaterThan(diff1);
  });

  it('ranks sum approximately to 1', async () => {
    await store.putNodes([makeEntity('A'), makeEntity('B'), makeEntity('C')]);
    await store.putEdges([makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')]);
    const ranks = await computePageRank(store);
    const sum = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});
