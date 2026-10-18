import { describe, it, expect } from 'vitest';
import { buildHierarchy } from '../../../../src/analysis/hierarchy/index.js';
import { buildFileGraph, W_CALL, W_FOLDER, W_IMPORT } from '../../../../src/analysis/zones/communities/file-graph.js';
import type { Relation, RelationType } from '../../../../src/contracts/relations.js';
import { fileEntity, symbolEntity, shuffled } from '../helpers.js';

const rel = (id: string, type: RelationType, from: string, to: string, extra: Partial<Relation> = {}): Relation => ({
  id, type, from, to, location: { file: 'x', line: 1, column: 0 }, weight: 1, confidence: 1, ...extra,
});

const files = ['src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts', 'src/b/four.ts', 'src/c/solo.ts', 'test/one.test.ts', 'package.json'];
const entities = [
  ...files.map((p) => fileEntity(p)),
  symbolEntity('src/a/one.ts', 'one'), symbolEntity('src/a/two.ts', 'two'), symbolEntity('src/a/two.ts', 'twoB'),
  symbolEntity('src/b/three.ts', 'three'), symbolEntity('src/b/four.ts', 'four'),
];
const h = buildHierarchy({ projectName: 'P', entities });
const weight = (g: ReturnType<typeof buildFileGraph>, a: string, b: string): number | undefined =>
  g.edges.find((e) => (e.a === `file:${a}` && e.b === `file:${b}`) || (e.a === `file:${b}` && e.b === `file:${a}`))?.weight;

describe('buildFileGraph', () => {
  it('weighs imports 1.0 (file or symbol endpoints), extend / implement 1.0, calls 0.5 once per file pair', () => {
    const g = buildFileGraph(h, [
      rel('1', 'import', 'f:src/a/one.ts', 'f:src/b/three.ts'),
      rel('2', 'extend', 's:src/a/two.ts#two', 's:src/b/four.ts#four'),
      rel('3', 'call', 's:src/a/one.ts#one', 's:src/b/four.ts#four'),
      rel('4', 'call', 's:src/a/one.ts#one', 's:src/b/four.ts#four', { weight: 9 }),
      rel('5', 'call', 's:src/a/two.ts#two', 's:src/b/four.ts#four'),
      rel('6', 'call', 's:src/a/two.ts#twoB', 's:src/b/four.ts#four'),
      rel('7', 'implement', 's:src/a/two.ts#twoB', 's:src/b/three.ts#three'),
    ]);
    expect(weight(g, 'src/a/one.ts', 'src/b/three.ts')).toBe(W_IMPORT);
    expect(weight(g, 'src/a/two.ts', 'src/b/four.ts')).toBe(1 + W_CALL); // extend + (two calls, counted once)
    expect(weight(g, 'src/a/one.ts', 'src/b/four.ts')).toBe(W_CALL); // two call relations, one pair
    expect(weight(g, 'src/a/two.ts', 'src/b/three.ts')).toBe(1);
  });

  it('counts a re-export barrel as an import and ignores other relation types and unresolved targets', () => {
    const g = buildFileGraph(h, [
      rel('1', 'import', 'f:src/a/one.ts', 'f:src/c/solo.ts', { meta: { reexport: true } }),
      rel('2', 'use', 's:src/a/one.ts#one', 's:src/b/four.ts#four'),
      rel('3', 'create', 's:src/a/one.ts#one', 's:src/b/three.ts#three'),
      rel('4', 'import', 'f:src/a/one.ts', '', { resolution: 'unresolved' }),
      rel('5', 'contain', 'f:src/a/one.ts', 's:src/a/one.ts#one'),
      rel('6', 'call', 's:src/a/one.ts#one', 's:src/a/one.ts#one'),
    ]);
    expect(weight(g, 'src/a/one.ts', 'src/c/solo.ts')).toBe(W_IMPORT);
    expect(weight(g, 'src/a/one.ts', 'src/b/four.ts')).toBeUndefined();
    expect(weight(g, 'src/a/one.ts', 'src/b/three.ts')).toBeUndefined();
  });

  it('adds the 0.3 same-folder affinity only between source files without another tie', () => {
    const g = buildFileGraph(h, [rel('1', 'import', 'f:src/a/one.ts', 'f:src/a/two.ts')]);
    expect(weight(g, 'src/a/one.ts', 'src/a/two.ts')).toBe(W_IMPORT); // a real tie replaces the affinity
    expect(weight(g, 'src/b/three.ts', 'src/b/four.ts')).toBe(W_FOLDER);
    expect(weight(g, 'src/a/one.ts', 'src/b/three.ts')).toBeUndefined(); // different folders
    expect(g.edges.some((e) => e.a.includes('test/') || e.b.includes('test/') || e.a.includes('package.json'))).toBe(false); // tests / config get none
  });

  it('keeps the edge between a test and the file it imports (it decides where the test goes)', () => {
    const g = buildFileGraph(h, [rel('1', 'import', 'f:test/one.test.ts', 'f:src/a/one.ts')]);
    expect(weight(g, 'test/one.test.ts', 'src/a/one.ts')).toBe(W_IMPORT);
  });

  it('does not depend on the order of the relations, and lists edges sorted', () => {
    const relations = Array.from({ length: 12 }, (_, i) =>
      rel(String(i), i % 3 === 0 ? 'call' : 'import', `f:${files[i % 4]}`, `f:${files[(i * 3 + 1) % 4]}`),
    );
    const a = buildFileGraph(h, relations);
    const b = buildFileGraph(h, shuffled(relations, 5));
    expect(b).toEqual(a);
    const keys = a.edges.map((e) => `${e.a}|${e.b}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('skips the affinity clique of folders with more than 80 files', () => {
    const many = Array.from({ length: 90 }, (_, i) => `src/big/f${i}.ts`);
    const bigH = buildHierarchy({ projectName: 'P', entities: many.map((p) => fileEntity(p)) });
    expect(buildFileGraph(bigH, []).edges).toEqual([]);
  });
});
