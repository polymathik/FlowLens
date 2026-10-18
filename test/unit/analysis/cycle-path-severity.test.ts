import { describe, it, expect } from 'vitest';
import { detectCyclesInData } from '../../../src/analysis/cycle-detector.js';
import { shortestCycleThrough } from '../../../src/analysis/cycle-path.js';
import { assessCycleSeverity } from '../../../src/analysis/cycle-severity.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';
import type { ArchitectureConfig } from '../../../src/contracts/architecture.js';

const file = (id: string, path: string): Entity => ({
  id, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path,
  location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 }, visibility: 'public', language: 'typescript',
});
const imp = (from: string, to: string): Relation => ({
  id: `${from}->${to}`, from, to, type: 'import', location: { file: '', line: 1, column: 0 }, weight: 1, confidence: 1,
});

describe('cycle path extraction', () => {
  it('returns a real closed cycle, not sorted members', () => {
    // a -> c -> b -> a (sorted members would suggest a -> b -> c)
    const adj = new Map([['a', new Set(['c'])], ['c', new Set(['b'])], ['b', new Set(['a'])]]);
    expect(shortestCycleThrough('a', new Set(['a', 'b', 'c']), adj)).toEqual(['a', 'c', 'b', 'a']);
  });

  it('takes the shortest way back through a chord', () => {
    const adj = new Map([['a', new Set(['b', 'c'])], ['b', new Set(['c'])], ['c', new Set(['a'])]]);
    expect(shortestCycleThrough('a', new Set(['a', 'b', 'c']), adj)).toEqual(['a', 'c', 'a']);
  });
});

describe('detectCyclesInData', () => {
  const entities = [
    file('A', 'src/api/a.ts'), file('B', 'src/core/b.ts'), file('C', 'src/core/c.ts'),
    file('X', 'lib/x.ts'), file('Y', 'lib/y.ts'),
  ];
  const edges = [imp('A', 'C'), imp('C', 'B'), imp('B', 'A'), imp('X', 'Y'), imp('Y', 'X')];

  it('file cycles carry ordered path, edges and labels', () => {
    const [c] = detectCyclesInData(entities, edges, { granularity: 'file', scope: 'src' });
    expect(c.path).toEqual(['src/api/a.ts', 'src/core/c.ts', 'src/core/b.ts', 'src/api/a.ts']);
    expect(c.entities.slice(0, 3)).toEqual(c.path!.slice(0, 3));
    expect(c.edges?.map((e) => e.relation_types)).toEqual([['import'], ['import'], ['import']]);
  });

  it('honours scope on segment boundaries', () => {
    expect(detectCyclesInData(entities, edges, { granularity: 'file', scope: 'lib' })).toHaveLength(1);
    expect(detectCyclesInData(entities, edges, { granularity: 'file', scope: 'li' })).toHaveLength(0);
    expect(detectCyclesInData(entities, edges, { granularity: 'file' })).toHaveLength(2);
  });

  it('module granularity uses directory modules, not the first path segment', () => {
    const mods = detectCyclesInData(entities, edges, { granularity: 'module' });
    expect(mods).toHaveLength(1);
    expect(mods[0].entities.sort()).toEqual(['src/api', 'src/core']);
  });

  it('cross-layer cycles are high severity with reasons', () => {
    const arch: ArchitectureConfig = {
      version: 2, inferred_by: 'manual', inferred_at: '',
      layers: [
        { name: 'api', include: { patterns: ['src/api/**'] } },
        { name: 'core', include: { patterns: ['src/core/**'] } },
      ],
    };
    const cycles = detectCyclesInData(entities, edges, { granularity: 'file', architecture: arch });
    const src = cycles.find((c) => c.entities.includes('src/api/a.ts'))!;
    expect(src.severity).toBe('high');
    expect(src.layers).toEqual(['api', 'core']);
    expect(src.severity_reasons?.[0]).toContain('crosses architecture layers');
    expect(cycles.find((c) => c.entities.includes('lib/x.ts'))!.severity).toBe('low');
  });
});

describe('assessCycleSeverity', () => {
  const base = { layers: [], moduleCount: 1, maxPageRankRatio: 1, externalDependents: 0, avgAfferentCoupling: 0 };
  it('grades low / medium / high', () => {
    expect(assessCycleSeverity(base).severity).toBe('low');
    expect(assessCycleSeverity({ ...base, moduleCount: 2 }).severity).toBe('medium');
    expect(assessCycleSeverity({ ...base, externalDependents: 7 }).severity).toBe('medium');
    expect(assessCycleSeverity({ ...base, moduleCount: 2, maxPageRankRatio: 3 }).severity).toBe('high');
    expect(assessCycleSeverity({ ...base, layers: ['a', 'b'] }).severity).toBe('high');
  });
});
