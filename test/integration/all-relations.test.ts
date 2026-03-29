import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import type { RelationType } from '../../src/contracts/relations.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('All 13 relation types', () => {
  let tmpDir: string;
  let store: LevelGraphStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-rels-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('indexes all-relations fixture and produces relations', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(result.relationsCreated).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('finds all expected relation types in the graph', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    // Collect all relations from every entity in the graph
    const allRelations = await collectAllRelations(store);
    const relationTypes = new Set(allRelations.map(r => r.type));

    // ---- Core structural relations (always resolvable same-file) ----
    expect(relationTypes.has('contain')).toBe(true);
    expect(relationTypes.has('extend')).toBe(true);
    expect(relationTypes.has('implement')).toBe(true);
    expect(relationTypes.has('override')).toBe(true);
    expect(relationTypes.has('call')).toBe(true);
    expect(relationTypes.has('create')).toBe(true);
    expect(relationTypes.has('decorate')).toBe(true);
    expect(relationTypes.has('mixin')).toBe(true);
    expect(relationTypes.has('import')).toBe(true);

    // ---- Type-annotation relations (require in-file entity resolution) ----
    // parameter: process(helper: Helper) — Helper is in-file entity
    expect(relationTypes.has('parameter')).toBe(true);

    // return: getBase(): Base — Base is in-file entity
    expect(relationTypes.has('return')).toBe(true);

    // throw: throw new AppError('oops') — AppError is in-file entity
    expect(relationTypes.has('throw')).toBe(true);

    // use: console.log(config) — config is a top-level variable entity
    expect(relationTypes.has('use')).toBe(true);
  });

  it('extend relation connects Child to Base', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const classes = await store.getNodesByKind('class');
    const child = classes.find(c => c.name === 'Child');
    expect(child).toBeDefined();

    const extendEdges = await store.getEdgesFrom(child!.id, 'extend');
    expect(extendEdges.length).toBe(1);

    const base = classes.find(c => c.name === 'Base');
    expect(base).toBeDefined();
    expect(extendEdges[0].to).toBe(base!.id);
  });

  it('implement relation connects Child to Printable', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const classes = await store.getNodesByKind('class');
    const child = classes.find(c => c.name === 'Child');
    expect(child).toBeDefined();

    const implEdges = await store.getEdgesFrom(child!.id, 'implement');
    expect(implEdges.length).toBe(1);

    const interfaces = await store.getNodesByKind('interface');
    const printable = interfaces.find(i => i.name === 'Printable');
    expect(printable).toBeDefined();
    expect(implEdges[0].to).toBe(printable!.id);
  });

  it('override relation connects Child.greet to Base.greet', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const methods = await store.getNodesByKind('method');
    const childGreet = methods.find(m => m.name === 'greet' && m.qualified_name.includes('Child'));
    const baseGreet = methods.find(m => m.name === 'greet' && m.qualified_name.includes('Base'));
    expect(childGreet).toBeDefined();
    expect(baseGreet).toBeDefined();

    const overrideEdges = await store.getEdgesFrom(childGreet!.id, 'override');
    expect(overrideEdges.length).toBe(1);
    expect(overrideEdges[0].to).toBe(baseGreet!.id);
  });

  it('contain relation connects Base to its members', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/all-relations'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const classes = await store.getNodesByKind('class');
    const base = classes.find(c => c.name === 'Base');
    expect(base).toBeDefined();

    const containEdges = await store.getEdgesFrom(base!.id, 'contain');
    expect(containEdges.length).toBeGreaterThanOrEqual(2); // name field + greet method
  });
});

// ─── Helpers ─────────────────────────────────────────────────────

async function collectAllRelations(store: LevelGraphStore) {
  const kinds = ['file', 'class', 'interface', 'function', 'method', 'variable', 'field', 'enum', 'decorator'] as const;
  const allRelations: Array<{ type: RelationType; from: string; to: string }> = [];

  for (const kind of kinds) {
    const entities = await store.getNodesByKind(kind);
    for (const entity of entities) {
      const edges = await store.getEdgesFrom(entity.id);
      for (const edge of edges) {
        allRelations.push({ type: edge.type, from: edge.from, to: edge.to });
      }
    }
  }

  // Also collect edges from unresolved IDs (decorators, mixins use unresolved:*)
  // These are stored as edges from the unresolved ID — not queryable by entity
  // but the relations were already collected from their "from" entities above.

  return allRelations;
}
