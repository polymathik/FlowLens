/**
 * Phase 8 store semantics: one edge per (from, type, to) with aggregated
 * weight; unresolved relations kept out of the edge keyspace.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { Relation } from '../../../src/contracts/relations.js';
import { countIdCollisions } from '../../../src/indexer/pass2.js';

const rel = (id: string, line: number, extra: Partial<Relation> = {}): Relation => ({
  id, from: 'a', to: 'b', type: 'call', location: { file: 'f.ts', line, column: 1 }, weight: 1, confidence: 1, ...extra,
});

let dir: string;
let store: LevelGraphStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fl-store-'));
  store = new LevelGraphStore();
  await store.open(join(dir, 'g'));
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('edge identity', () => {
  it('aggregates repeated edges in one batch into weight', async () => {
    await store.putEdges([rel('e1', 1), rel('e2', 5), rel('e3', 9)]);
    const edges = await store.getAllEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(3);
    expect(edges[0].id).toBe('e1');
    expect(await store.getEdgesFrom('a')).toHaveLength(1);
  });

  it('a later write with the same key replaces the edge without stale index entries', async () => {
    await store.putEdges([rel('e1', 1)]);
    await store.putEdges([rel('e2', 2, { weight: 4 })]);
    const edges = await store.getAllEdges();
    expect(edges.map((e) => [e.id, e.weight])).toEqual([['e2', 4]]);
    await store.deleteEdgesByFile('f.ts');
    expect(await store.getAllEdges()).toEqual([]);
  });

  it('keeps unresolved relations out of edge reads and deletes them by file', async () => {
    await store.putEdges([
      rel('e1', 1),
      rel('u1', 2, { to: '', resolution: 'unresolved', target_name: 'Missing' }),
      rel('u2', 3, { to: '', resolution: 'ambiguous', target_name: 'Dup', meta: { candidates: ['x', 'y'] } }),
    ]);
    expect((await store.getAllEdges()).map((e) => e.id)).toEqual(['e1']);
    expect(await store.getEdgesTo('')).toEqual([]);
    const unresolved = await store.getUnresolvedRelations();
    expect(unresolved.map((r) => r.target_name).sort()).toEqual(['Dup', 'Missing']);
    await store.deleteEdgesByFile('f.ts');
    expect(await store.getUnresolvedRelations()).toEqual([]);
  });

  it('replaceFile swaps a file\'s nodes and edges in one call', async () => {
    const node = (id: string) => ({
      id, kind: 'function' as const, name: id, qualified_name: `f.ts/${id}`, file: 'f.ts',
      location: { line_start: 1, line_end: 1, column_start: 1, column_end: 1 }, visibility: 'public' as const, language: 'typescript',
    });
    await store.replaceFile('f.ts', [node('a'), node('b')], [rel('e1', 1)]);
    await store.replaceFile('f.ts', [node('a')], []);
    expect((await store.getAllNodes()).map((n) => n.id)).toEqual(['a']);
    expect(await store.getAllEdges()).toEqual([]);
  });
});

describe('id collisions', () => {
  it('counts the same id produced by two files', () => {
    const e = (id: string, file: string) => ({ id, name: 'x', qualified_name: `${file}/x`, kind: 'class' as const, file, language: 'ts' });
    const records = new Map([
      ['a.ts', { symbols: { file: 'a.ts', language: 'ts', imports: [], exports: [], reexports: [] }, entities: [e('1', 'a.ts')], extends: [] }],
      ['b.ts', { symbols: { file: 'b.ts', language: 'ts', imports: [], exports: [], reexports: [] }, entities: [e('1', 'b.ts'), e('2', 'b.ts')], extends: [] }],
    ]);
    expect(countIdCollisions(records).count).toBe(1);
  });
});
