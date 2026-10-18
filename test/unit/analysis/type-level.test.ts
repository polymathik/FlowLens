import { describe, it, expect } from 'vitest';
import { isTypeLevelRelation } from '../../../src/analysis/type-level.js';
import { collapseGraph } from '../../../src/analysis/graph-collapse.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';

const rel = (from: string, to: string, type: RelationType, meta?: Relation['meta']): Relation => ({
  id: `${from}-${type}-${to}`, from, to, type, location: { file: 'x', line: 1, column: 0 }, weight: 1, confidence: 1, ...(meta ? { meta } : {}),
});
const ent = (id: string, file: string, kind: Entity['kind'] = 'function'): Entity => ({
  id, kind, name: id, qualified_name: `${file}/${id}`, file,
  location: { line_start: 1, line_end: 2, column_start: 0, column_end: 1 }, visibility: 'public', language: 'typescript',
});

describe('isTypeLevelRelation', () => {
  it('treats import type, annotations and pure-type targets as type-level', () => {
    expect(isTypeLevelRelation(rel('a', 'b', 'import', { type_only: true }))).toBe(true);
    expect(isTypeLevelRelation(rel('a', 'b', 'parameter'))).toBe(true);
    expect(isTypeLevelRelation(rel('a', 'b', 'return'))).toBe(true);
    expect(isTypeLevelRelation(rel('a', 'b', 'implement'))).toBe(true);
    expect(isTypeLevelRelation(rel('a', 'b', 'extend'), 'interface')).toBe(true);
    expect(isTypeLevelRelation(rel('a', 'b', 'use'), 'type')).toBe(true);
  });

  it('keeps runtime edges', () => {
    expect(isTypeLevelRelation(rel('a', 'b', 'import'))).toBe(false);
    expect(isTypeLevelRelation(rel('a', 'b', 'import'), 'interface')).toBe(false);
    expect(isTypeLevelRelation(rel('a', 'b', 'call'), 'function')).toBe(false);
    expect(isTypeLevelRelation(rel('a', 'b', 'extend'), 'class')).toBe(false);
  });
});

describe('collapseGraph type-level handling', () => {
  const entities = [ent('fa', 'a.ts', 'file'), ent('fb', 'b.ts', 'file'), ent('I', 'b.ts', 'interface')];
  const edges = [rel('fa', 'fb', 'import', { type_only: true }), rel('fa', 'I', 'parameter'), rel('fb', 'fa', 'import')];

  it('drops type-level edges by default', () => {
    const g = collapseGraph(entities, edges, 'file');
    expect([...g.adjacency.get('a.ts')!]).toEqual([]);
    expect([...g.adjacency.get('b.ts')!]).toEqual(['a.ts']);
  });

  it('keeps them with includeTypeOnly and marks hops made only of them', () => {
    const g = collapseGraph(entities, edges, 'file', undefined, { includeTypeOnly: true });
    expect([...g.adjacency.get('a.ts')!]).toEqual(['b.ts']);
    expect(g.typeOnlyHops.has('a.ts->b.ts')).toBe(true);
    expect(g.typeOnlyHops.has('b.ts->a.ts')).toBe(false);
  });

  it('a hop with any runtime relation is not type-only', () => {
    const g = collapseGraph(entities, [...edges, rel('fa', 'fb', 'call')], 'file', undefined, { includeTypeOnly: true });
    expect(g.typeOnlyHops.has('a.ts->b.ts')).toBe(false);
  });
});
