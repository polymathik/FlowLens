/**
 * Golden graph tests (Phase 8): each fixture is indexed end-to-end and the
 * resulting cross-file edges are compared with the exact expected set.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { indexFixture, edgeStrings, danglingEdges, findEdge, type IndexedFixture } from './harness.js';
import type { RelationType } from '../../src/contracts/relations.js';
import { EXPECTED } from './expected.js';

const EXACT_TYPES: RelationType[] = [
  'import', 'extend', 'implement', 'override', 'call', 'create', 'throw', 'return', 'decorate',
];

const opened: IndexedFixture[] = [];
afterAll(async () => {
  for (const fx of opened) await fx.cleanup();
});

describe.each(Object.entries(EXPECTED))('golden fixture %s', (name, exp) => {
  let fx: IndexedFixture;

  it('indexes and produces exactly the expected edges', async () => {
    fx = await indexFixture(name);
    opened.push(fx);
    const actual = edgeStrings(fx, EXACT_TYPES);
    expect(actual).toEqual([...exp.edges].sort());
  });

  it('has no dangling edges, collisions or unresolved relations', () => {
    expect(danglingEdges(fx)).toEqual([]);
    expect(fx.unresolved.map((r) => `${r.type} ${r.target_name}`)).toEqual([]);
    expect(fx.result.quality.id_collisions).toBe(0);
    expect(fx.result.quality.duplicate_declarations).toBe(exp.duplicates ?? 0);
    expect(fx.result.quality.dangling_ratio).toBe(0);
    expect(fx.result.quality.import_resolution_rate).toBe(1);
  });

  it('reports the same counts it stored', () => {
    expect(fx.result.entitiesCreated).toBe(fx.nodes.length);
    expect(fx.result.relationsCreated).toBe(fx.edges.length);
    expect(fx.result.quality.entity_count).toBe(fx.nodes.length);
    expect(fx.result.quality.edge_count).toBe(fx.edges.length);
  });

  it('has unique entity ids and expected qualified names', () => {
    const ids = fx.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const qns = new Set(fx.nodes.map((n) => n.qualified_name));
    for (const qn of exp.entities ?? []) expect(qns, qn).toContain(qn);
  });
});

describe('golden details', () => {
  it('marks type-only imports and aggregates repeated edges', async () => {
    const fx = await indexFixture('ts-esm');
    opened.push(fx);
    const typeOnly = findEdge(fx, 'import', 'src/models/user.ts', 'src/lib/base.ts');
    expect(typeOnly?.meta?.type_only).toBe(true);
    const valueImport = findEdge(fx, 'import', 'src/main.ts', 'src/services/service.ts');
    expect(valueImport?.meta?.type_only).toBeFalsy();
    // util.helper(2) and aliasHelper(1) both call util.ts/helper
    const call = findEdge(fx, 'call', 'src/services/service.ts/Service.run', 'src/lib/util.ts/helper');
    expect(call?.weight).toBe(2);
    expect(call?.resolution).toBe('resolved');
    const local = findEdge(fx, 'call', 'src/services/service.ts/Other.run', 'src/services/service.ts/Other.describe');
    expect(local?.resolution ?? 'direct').toBe('direct');
  });

  it('gives parameters function-scoped qualified names', async () => {
    const fx = await indexFixture('ts-esm');
    opened.push(fx);
    const params = fx.nodes.filter((n) => n.kind === 'parameter').map((n) => n.qualified_name).sort();
    expect(params).toEqual(expect.arrayContaining([
      'src/main.ts/configure.name',
      'src/main.ts/configure.retries',
      'src/main.ts/start.name',
      'src/lib/util.ts/format.value',
      'src/lib/util.ts/format.width',
      'src/lib/util.ts/helper.x',
    ]));
  });
});
