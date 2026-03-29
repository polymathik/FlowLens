import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { Entity } from '../../../src/contracts/entities.js';
import type { Relation } from '../../../src/contracts/relations.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'abc123',
    kind: 'class',
    name: 'Foo',
    qualified_name: 'src/foo.ts/Foo',
    file: 'src/foo.ts',
    location: { line_start: 1, line_end: 10, column_start: 0, column_end: 1 },
    visibility: 'public',
    language: 'typescript',
    ...overrides,
  };
}

function makeRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    id: 'rel001',
    from: 'abc123',
    to: 'def456',
    type: 'import',
    location: { file: 'src/foo.ts', line: 1, column: 0 },
    weight: 1,
    confidence: 1.0,
    ...overrides,
  };
}

describe('LevelGraphStore', () => {
  let store: LevelGraphStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = await mkdtemp(join(tmpdir(), 'flowlens-test-'));
    store = new LevelGraphStore();
    await store.open(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await rm(dbPath, { recursive: true, force: true });
  });

  it('puts and gets a node', async () => {
    const entity = makeEntity();
    await store.putNode(entity);
    const result = await store.getNode('abc123');
    expect(result).toEqual(entity);
  });

  it('returns null for missing node', async () => {
    const result = await store.getNode('nonexistent');
    expect(result).toBeNull();
  });

  it('gets nodes by kind', async () => {
    await store.putNode(makeEntity({ id: 'a', kind: 'class', name: 'A' }));
    await store.putNode(makeEntity({ id: 'b', kind: 'function', name: 'B' }));
    await store.putNode(makeEntity({ id: 'c', kind: 'class', name: 'C' }));
    const classes = await store.getNodesByKind('class');
    expect(classes).toHaveLength(2);
  });

  it('gets nodes by file', async () => {
    await store.putNode(makeEntity({ id: 'a', file: 'src/a.ts' }));
    await store.putNode(makeEntity({ id: 'b', file: 'src/b.ts' }));
    const nodes = await store.getNodesByFile('src/a.ts');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('a');
  });

  it('deletes a node and its indexes', async () => {
    await store.putNode(makeEntity());
    await store.deleteNode('abc123');
    expect(await store.getNode('abc123')).toBeNull();
    expect(await store.getNodesByKind('class')).toHaveLength(0);
  });

  it('deletes all nodes for a file', async () => {
    await store.putNode(makeEntity({ id: 'a', file: 'src/x.ts' }));
    await store.putNode(makeEntity({ id: 'b', file: 'src/x.ts' }));
    await store.putNode(makeEntity({ id: 'c', file: 'src/y.ts' }));
    await store.deleteNodesByFile('src/x.ts');
    expect(await store.getNodesByFile('src/x.ts')).toHaveLength(0);
    expect(await store.getNodesByFile('src/y.ts')).toHaveLength(1);
  });

  it('puts and gets edges', async () => {
    const rel = makeRelation();
    await store.putEdge(rel);
    const from = await store.getEdgesFrom('abc123');
    expect(from).toHaveLength(1);
    expect(from[0]).toEqual(rel);
  });

  it('gets edges to a target', async () => {
    await store.putEdge(makeRelation());
    const to = await store.getEdgesTo('def456');
    expect(to).toHaveLength(1);
  });

  it('filters edges by type', async () => {
    await store.putEdge(makeRelation({ id: 'r1', type: 'import' }));
    await store.putEdge(makeRelation({ id: 'r2', type: 'call', from: 'abc123', to: 'ghi789' }));
    const imports = await store.getEdgesFrom('abc123', 'import');
    expect(imports).toHaveLength(1);
    expect(imports[0].type).toBe('import');
  });

  it('bulk puts nodes', async () => {
    await store.putNodes([
      makeEntity({ id: 'a', name: 'A' }),
      makeEntity({ id: 'b', name: 'B' }),
    ]);
    expect(await store.getNode('a')).not.toBeNull();
    expect(await store.getNode('b')).not.toBeNull();
  });

  it('clears all data', async () => {
    await store.putNode(makeEntity());
    await store.putEdge(makeRelation());
    await store.clear();
    expect(await store.getNode('abc123')).toBeNull();
    expect(await store.getEdgesFrom('abc123')).toHaveLength(0);
  });

  it('getAllNodes returns all stored entities', async () => {
    await store.putNode(makeEntity({ id: 'a', name: 'A' }));
    await store.putNode(makeEntity({ id: 'b', name: 'B' }));
    const all = await store.getAllNodes();
    expect(all).toHaveLength(2);
  });

  it('getAllEdges returns all stored relations', async () => {
    await store.putEdge(makeRelation({ id: 'r1' }));
    await store.putEdge(makeRelation({ id: 'r2', from: 'x', to: 'y' }));
    const all = await store.getAllEdges();
    expect(all).toHaveLength(2);
  });

  it('getAllEdges excludes internal index triples', async () => {
    await store.putNode(makeEntity({ id: 'a' }));
    await store.putEdge(makeRelation({ id: 'r1' }));
    const edges = await store.getAllEdges();
    // Should only return the relation, not the internal 'entity', 'in_file', 'edge_idx', 'edge_in_file' triples
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe('import');
  });
});
