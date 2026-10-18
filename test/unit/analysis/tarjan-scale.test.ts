import { describe, it, expect } from 'vitest';
import { findStronglyConnectedComponents } from '../../../src/analysis/tarjan.js';
import { buildLayerMap, resolveLayer } from '../../../src/analysis/architecture-validator.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { ArchitectureConfig } from '../../../src/contracts/architecture.js';

describe('Tarjan at scale (iterative)', () => {
  it('handles a 50K-node import chain without stack overflow', () => {
    const n = 50_000;
    const adj = new Map<string, Set<string>>();
    for (let i = 0; i < n; i++) adj.set(`f${i}`, new Set(i + 1 < n ? [`f${i + 1}`] : []));
    expect(findStronglyConnectedComponents(adj)).toEqual([]);
    adj.get(`f${n - 1}`)!.add('f0'); // close the chain into one giant cycle
    const sccs = findStronglyConnectedComponents(adj);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]).toHaveLength(n);
  });

  it('finds multiple and nested SCCs like the recursive version', () => {
    const adj = new Map<string, Set<string>>([
      ['a', new Set(['b'])], ['b', new Set(['c', 'd'])], ['c', new Set(['a'])],
      ['d', new Set(['e'])], ['e', new Set(['d'])], ['f', new Set(['a'])],
    ]);
    const sccs = findStronglyConnectedComponents(adj).map((s) => s.sort().join(''));
    expect(sccs.sort()).toEqual(['abc', 'de']);
  });
});

describe('buildLayerMap per-file caching', () => {
  const ent = (id: string, file: string, name = id): Entity => ({
    id, kind: 'function', name, qualified_name: `${file}/${name}`, file,
    location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 }, visibility: 'public', language: 'typescript',
  });
  const config: ArchitectureConfig = {
    version: 2, inferred_by: 'manual', inferred_at: '',
    layers: [
      { name: 'special', include: { entities: ['magic'] } },
      { name: 'api', include: { patterns: ['src/api/**'] } },
      { name: 'late', include: { entities: ['ignored'] } },
      { name: 'files', include: { files: ['root.ts'] } },
    ],
  };

  it('matches resolveLayer for every entity (first match wins)', () => {
    const entities = [
      ent('1', 'src/api/a.ts'), ent('2', 'src/api/a.ts', 'magic'), ent('3', 'src/api/b.ts', 'ignored'),
      ent('4', 'root.ts'), ent('5', 'other.ts', 'ignored'), ent('6', 'other.ts'),
    ];
    const map = buildLayerMap(entities, config);
    for (const e of entities) expect(map.get(e.id), e.id).toBe(resolveLayer(e, config));
    expect([...map.values()]).toEqual(['api', 'special', 'api', 'files', 'late', null]);
  });

  it('assigns 60K entities quickly', () => {
    const entities = Array.from({ length: 60_000 }, (_, i) => ent(`e${i}`, `src/api/f${i % 3000}.ts`));
    const t0 = performance.now();
    buildLayerMap(entities, config);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
