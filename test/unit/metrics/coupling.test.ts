import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { computeCouplingMetrics } from '../../../src/metrics/coupling.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeEntity(id: string, file = 'src/test.ts'): Entity {
  return {
    id,
    kind: 'class',
    name: id,
    qualified_name: `${file}/${id}`,
    file,
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 1 },
    visibility: 'public',
    language: 'typescript',
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

describe('computeCouplingMetrics', () => {
  let store: LevelGraphStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), 'flowlens-coupling-test-'));
    store = new LevelGraphStore();
    await store.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await rm(dbPath, { recursive: true, force: true });
  });

  it('returns Ca=0, Ce=0, instability=0 for entity with no edges', async () => {
    await store.putNode(makeEntity('A'));
    const result = await computeCouplingMetrics('A', store);
    expect(result.afferent_coupling).toBe(0);
    expect(result.efferent_coupling).toBe(0);
    expect(result.instability).toBe(0);
  });

  it('counts afferent coupling (incoming edges)', async () => {
    // 3 entities point TO 'target'
    await store.putNode(makeEntity('target'));
    await store.putNode(makeEntity('src1'));
    await store.putNode(makeEntity('src2'));
    await store.putNode(makeEntity('src3'));

    await store.putEdge(makeRelation('r1', 'src1', 'target'));
    await store.putEdge(makeRelation('r2', 'src2', 'target'));
    await store.putEdge(makeRelation('r3', 'src3', 'target'));

    const result = await computeCouplingMetrics('target', store);
    expect(result.afferent_coupling).toBe(3);
    expect(result.efferent_coupling).toBe(0);
  });

  it('counts efferent coupling (outgoing edges)', async () => {
    // 'source' points TO 5 entities
    await store.putNode(makeEntity('source'));
    for (let i = 1; i <= 5; i++) {
      await store.putNode(makeEntity(`dep${i}`));
      await store.putEdge(makeRelation(`r${i}`, 'source', `dep${i}`));
    }

    const result = await computeCouplingMetrics('source', store);
    expect(result.afferent_coupling).toBe(0);
    expect(result.efferent_coupling).toBe(5);
  });

  it('computes instability = Ce / (Ca + Ce)', async () => {
    // target: 3 incoming (Ca=3), 5 outgoing (Ce=5)
    await store.putNode(makeEntity('target'));
    for (let i = 1; i <= 3; i++) {
      await store.putNode(makeEntity(`inc${i}`));
      await store.putEdge(makeRelation(`ri${i}`, `inc${i}`, 'target'));
    }
    for (let i = 1; i <= 5; i++) {
      await store.putNode(makeEntity(`out${i}`));
      await store.putEdge(makeRelation(`ro${i}`, 'target', `out${i}`));
    }

    const result = await computeCouplingMetrics('target', store);
    expect(result.afferent_coupling).toBe(3);
    expect(result.efferent_coupling).toBe(5);
    // 5 / (3 + 5) = 0.625
    expect(result.instability).toBeCloseTo(0.625);
  });

  it('instability = 0 for entity with only incoming edges (maximally stable)', async () => {
    await store.putNode(makeEntity('stable'));
    await store.putNode(makeEntity('caller1'));
    await store.putNode(makeEntity('caller2'));

    await store.putEdge(makeRelation('r1', 'caller1', 'stable'));
    await store.putEdge(makeRelation('r2', 'caller2', 'stable'));

    const result = await computeCouplingMetrics('stable', store);
    expect(result.afferent_coupling).toBe(2);
    expect(result.efferent_coupling).toBe(0);
    expect(result.instability).toBe(0);
  });

  it('instability = 1.0 for entity with only outgoing edges (maximally unstable)', async () => {
    await store.putNode(makeEntity('unstable'));
    await store.putNode(makeEntity('dep1'));
    await store.putNode(makeEntity('dep2'));

    await store.putEdge(makeRelation('r1', 'unstable', 'dep1'));
    await store.putEdge(makeRelation('r2', 'unstable', 'dep2'));

    const result = await computeCouplingMetrics('unstable', store);
    expect(result.afferent_coupling).toBe(0);
    expect(result.efferent_coupling).toBe(2);
    expect(result.instability).toBe(1.0);
  });

  it('counts unique sources for afferent coupling (deduplicates multiple edges from same entity)', async () => {
    // Two edges from same source to target (different relation types)
    await store.putNode(makeEntity('target'));
    await store.putNode(makeEntity('srcA'));

    await store.putEdge(makeRelation('r1', 'srcA', 'target'));
    await store.putEdge({ ...makeRelation('r2', 'srcA', 'target'), type: 'call' });

    const result = await computeCouplingMetrics('target', store);
    // Ca should be 1 unique source, not 2
    expect(result.afferent_coupling).toBe(1);
  });

  it('counts unique targets for efferent coupling (deduplicates multiple edges to same entity)', async () => {
    // Two edges from source to same target
    await store.putNode(makeEntity('source'));
    await store.putNode(makeEntity('depA'));

    await store.putEdge(makeRelation('r1', 'source', 'depA'));
    await store.putEdge({ ...makeRelation('r2', 'source', 'depA'), type: 'call' });

    const result = await computeCouplingMetrics('source', store);
    // Ce should be 1 unique target, not 2
    expect(result.efferent_coupling).toBe(1);
  });
});
