/**
 * Golden-test harness: index a fixture project into a temp LevelGraph store
 * and render the graph as stable, human-readable edge strings
 * (`type from_qn -> to_qn`) so tests can assert exact edge sets.
 */
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIndex, type IndexResult } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import type { Entity } from '../../src/contracts/entities.js';
import type { Relation, RelationType } from '../../src/contracts/relations.js';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

export interface IndexedFixture {
  root: string;
  store: LevelGraphStore;
  result: IndexResult;
  nodes: Entity[];
  edges: Relation[];
  unresolved: Relation[];
  byId: Map<string, Entity>;
  reindex(): Promise<IndexResult>;
  refresh(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Copy a fixture (or any directory) to a temp dir and index it.
 * `prepare(root)` runs on the copy before the first index (e.g. to create build output).
 */
export async function indexFixture(
  nameOrPath: string,
  prepare?: (root: string) => void,
): Promise<IndexedFixture> {
  const src = nameOrPath.startsWith('/') ? nameOrPath : join(FIXTURES, nameOrPath);
  const root = mkdtempSync(join(tmpdir(), 'fl-golden-'));
  cpSync(src, root, { recursive: true });
  prepare?.(root);
  const flowlensDir = join(root, '.flowlens');
  const store = new LevelGraphStore();
  await store.open(join(flowlensDir, 'graph'));
  const run = (incremental: boolean) =>
    runIndex({
      rootDir: root,
      graphStore: store,
      config: { exclude: ['.flowlens/**'], languages: {} },
      fileIndexPath: join(flowlensDir, 'file_index.json'),
      incremental,
    });
  const fx = {
    root,
    store,
    result: await run(false),
    nodes: [] as Entity[],
    edges: [] as Relation[],
    unresolved: [] as Relation[],
    byId: new Map<string, Entity>(),
    async refresh() {
      fx.nodes = await store.getAllNodes();
      fx.edges = await store.getAllEdges();
      fx.unresolved = (await store.getUnresolvedRelations?.()) ?? [];
      fx.byId = new Map(fx.nodes.map((n) => [n.id, n]));
    },
    async reindex() {
      fx.result = await run(true);
      await fx.refresh();
      return fx.result;
    },
    async cleanup() {
      await store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  await fx.refresh();
  return fx;
}

/** Render edges of the given types as sorted `type from -> to` strings. */
export function edgeStrings(fx: IndexedFixture, types: RelationType[]): string[] {
  const wanted = new Set(types);
  const out = new Set<string>();
  for (const e of fx.edges) {
    if (!wanted.has(e.type)) continue;
    const from = fx.byId.get(e.from)?.qualified_name ?? `?${e.from}`;
    const to = fx.byId.get(e.to)?.qualified_name ?? `?${e.to}`;
    out.add(`${e.type} ${from} -> ${to}`);
  }
  return [...out].sort();
}

export function findEdge(fx: IndexedFixture, type: RelationType, fromQn: string, toQn: string): Relation | undefined {
  return fx.edges.find(
    (e) => e.type === type
      && fx.byId.get(e.from)?.qualified_name === fromQn
      && fx.byId.get(e.to)?.qualified_name === toQn,
  );
}

export function danglingEdges(fx: IndexedFixture): Relation[] {
  return fx.edges.filter((e) => !fx.byId.has(e.from) || !fx.byId.has(e.to));
}
