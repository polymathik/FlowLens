import { describe, it, expect } from 'vitest';
import { NameIndex, editDistance } from '../../../src/mcp/name-index.js';
import type { Entity, EntityKind } from '../../../src/contracts/entities.js';

function ent(id: string, kind: EntityKind, qn: string, file = qn.split('/').slice(0, -1).join('/') || qn): Entity {
  const name = qn.split(/[/.]/).filter(Boolean).pop()!;
  return {
    id, kind, name: kind === 'file' ? qn.split('/').pop()! : name, qualified_name: qn, file,
    location: { line_start: 3, line_end: 9, column_start: 0, column_end: 0 }, visibility: 'public', language: 'typescript',
  };
}

const NODES: Entity[] = [
  ent('f1', 'file', 'src/graph/store.ts', 'src/graph/store.ts'),
  ent('c1', 'class', 'src/graph/store.ts/LevelGraphStore', 'src/graph/store.ts'),
  ent('m1', 'method', 'src/graph/store.ts/LevelGraphStore.getAllNodes', 'src/graph/store.ts'),
  ent('m2', 'method', 'src/graph/store.ts/LevelGraphStore.open', 'src/graph/store.ts'),
  ent('fn1', 'function', 'src/indexer/indexer.ts/runIndex', 'src/indexer/indexer.ts'),
  ent('fn2', 'function', 'bench/run.ts/runIndexBenchmark', 'bench/run.ts'),
  ent('p1', 'parameter', 'src/indexer/indexer.ts/graph', 'src/indexer/indexer.ts'),
  ent('v1', 'variable', 'src/x.ts/graph', 'src/x.ts'),
  ent('d1', 'function', 'src/a.ts/getModulePath', 'src/a.ts'),
  ent('d2', 'function', 'src/b.ts/getModulePath', 'src/b.ts'),
  ent('mod', 'module', 'src/graph', 'src/graph'),
];

const idx = new NameIndex(NODES);

describe('NameIndex tiers', () => {
  it('exact id and qualified name win first', () => {
    expect(idx.match('c1')).toMatchObject({ tier: 'id' });
    expect(idx.match('src/graph/store.ts/LevelGraphStore')?.candidates.map((e) => e.id)).toEqual(['c1']);
  });

  it('file and directory paths resolve to file/module entities', () => {
    expect(idx.match('./src/graph/store.ts')).toMatchObject({ tier: 'path' });
    expect(idx.match('src/graph/')?.candidates[0].kind).toBe('module');
  });

  it('a class name does not match its own members', () => {
    expect(idx.match('LevelGraphStore')).toMatchObject({ tier: 'name', candidates: [expect.objectContaining({ id: 'c1' })] });
  });

  it('exact name beats prefix collisions (runIndex vs runIndexBenchmark)', () => {
    expect(idx.match('runIndex')?.candidates.map((e) => e.id)).toEqual(['fn1']);
    expect(idx.match('runindexbench')?.candidates.map((e) => e.id)).toEqual(['fn2']);
  });

  it('segment suffix matches Class.method', () => {
    expect(idx.match('LevelGraphStore.open')).toMatchObject({ tier: 'segment_suffix', candidates: [expect.objectContaining({ id: 'm2' })] });
  });

  it('parameters lose to other kinds of the same name', () => {
    expect(idx.match('graph')?.candidates.map((e) => e.id).sort()).toEqual(['mod', 'v1']);
  });

  it('true duplicates are all returned (ambiguous)', () => {
    expect(idx.match('getModulePath')?.candidates.map((e) => e.id).sort()).toEqual(['d1', 'd2']);
  });

  it('substring is the last resort and never uses qualified names', () => {
    expect(idx.match('AllNod')).toMatchObject({ tier: 'name_substring' });
    expect(idx.match('indexer')).toBeNull(); // only in qualified names / file paths
  });

  it('suggests close names by edit distance', () => {
    expect(idx.suggest('runIndx').map((e) => e.id)).toContain('fn1');
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
