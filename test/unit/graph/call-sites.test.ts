/**
 * Parser truth 2, item 3: every call site survives edge aggregation.
 */
import { describe, it, expect } from 'vitest';
import { aggregateRelations } from '../../../src/graph/aggregate.js';
import { relationSites } from '../../../src/graph/sites.js';
import { MAX_RELATION_SITES, type Relation, type RelationType } from '../../../src/contracts/relations.js';
import { extractRelations } from '../../../src/parser/relation-extractor.js';
import { extractEntities } from '../../../src/parser/entity-extractor.js';
import { parse } from '@ast-grep/napi';

function rel(type: RelationType, line: number, column = 1, extra: Partial<Relation> = {}): Relation {
  return {
    id: `${type}-${line}-${column}`, from: 'a', to: 'b', type,
    location: { file: 'x.ts', line, column }, weight: 1, confidence: 1, ...extra,
  };
}

describe('aggregateRelations keeps call sites', () => {
  it('a single occurrence carries no sites (its site is the location)', () => {
    const [r] = aggregateRelations([rel('call', 3, 5)]);
    expect(r.meta).toBeUndefined();
    expect(relationSites(r)).toEqual([{ line: 3, column: 5 }]);
  });

  it('collects every occurrence of call/create/use/throw, sorted, location stays the first emitted', () => {
    for (const type of ['call', 'create', 'use', 'throw'] as const) {
      const [r] = aggregateRelations([rel(type, 9, 2), rel(type, 4, 7), rel(type, 4, 3)]);
      expect(r.weight).toBe(3);
      expect(r.location).toEqual({ file: 'x.ts', line: 9, column: 2 });
      expect(r.meta?.sites).toEqual([{ line: 4, column: 3 }, { line: 4, column: 7 }, { line: 9, column: 2 }]);
      expect(r.meta?.sites_total).toBe(3);
    }
  });

  it('does not add sites to other relation types', () => {
    const [r] = aggregateRelations([rel('import', 1), rel('import', 2)]);
    expect(r.weight).toBe(2);
    expect(r.meta).toBeUndefined();
  });

  it('caps at MAX_RELATION_SITES but keeps the total, earliest sites first', () => {
    const many = Array.from({ length: 50 }, (_, i) => rel('call', 100 - i));
    const [r] = aggregateRelations(many);
    expect(r.meta?.sites).toHaveLength(MAX_RELATION_SITES);
    expect(r.meta?.sites?.[0]).toEqual({ line: 51, column: 1 });
    expect(r.meta?.sites_total).toBe(50);
    expect(r.weight).toBe(50);
  });

  it('merges already-aggregated edges (pass 2 re-aggregation) and survives type_only handling', () => {
    const a = aggregateRelations([rel('call', 10), rel('call', 12)])[0];
    const b = aggregateRelations([rel('call', 3), rel('call', 40), rel('call', 41)])[0];
    const [m] = aggregateRelations([a, b]);
    expect(m.weight).toBe(5);
    expect(m.meta?.sites?.map((s) => s.line)).toEqual([3, 10, 12, 40, 41]);
    expect(m.meta?.sites_total).toBe(5);
  });

  it('does not mutate its input', () => {
    const a = aggregateRelations([rel('call', 1), rel('call', 2)])[0];
    const snapshot = JSON.stringify(a);
    aggregateRelations([a, rel('call', 3)]);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('extractor emits every call line', () => {
  it('records all call sites of one callee inside one function', () => {
    const src = [
      'function helper() {}',
      'export function run() {',
      '  helper();',
      '  if (x) { helper(); }',
      '  return helper();',
      '}',
    ].join('\n');
    const root = parse('TypeScript', src).root();
    const entities = extractEntities(root, 'a.ts', 'typescript');
    const calls = extractRelations(root, 'a.ts', entities, '').filter((r) => r.type === 'call');
    expect(calls).toHaveLength(1);
    expect(calls[0].weight).toBe(3);
    expect(calls[0].meta?.sites).toEqual([{ line: 3, column: 3 }, { line: 4, column: 12 }, { line: 5, column: 10 }]);
  });
});
