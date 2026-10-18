/**
 * Per-graph-load cache of derived data for MCP tool calls.
 *
 * Every tool used to scan `getAllNodes()`/`getAllEdges()` (≈150 ms on the
 * FlowLens self-index) and issue one LevelDB query per neighbour. A GraphView
 * loads the graph once, builds id/adjacency/file/name indexes, and memoises
 * derived analyses (cycles, layer assignment, violations) until the graph
 * changes.
 *
 * Invalidation: a cheap fingerprint — size + mtime of every file in the
 * LevelDB directory plus `file_index.json` — is checked on each call. Any
 * writer (indexer, `serve --watch`, another process) appends to the LevelDB
 * log, so the fingerprint changes. Stores without an on-disk directory are
 * never cached unless `deps.graphVersion` supplies a version token.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import { getLastIndexed } from './last-indexed.js';
import { NameIndex } from './name-index.js';

export interface GraphViewSource {
  graph: GraphStore;
  flowlensDir: string;
  fileIndexPath: string;
  /** LevelDB directory (default `<flowlensDir>/graph`). */
  graphPath?: string;
  /** Optional explicit version token (e.g. from a graph service); overrides the fs fingerprint. */
  graphVersion?: () => string | Promise<string>;
}

export class GraphView {
  readonly byId = new Map<string, Entity>();
  readonly out = new Map<string, Relation[]>();
  readonly in = new Map<string, Relation[]>();
  readonly byFile = new Map<string, Entity[]>();
  private nameIndex: NameIndex | null = null;
  private readonly memo = new Map<string, unknown>();

  constructor(
    readonly nodes: Entity[],
    readonly edges: Relation[],
    readonly lastIndexed: string,
  ) {
    for (const n of nodes) {
      this.byId.set(n.id, n);
      const list = this.byFile.get(n.file);
      if (list) list.push(n);
      else this.byFile.set(n.file, [n]);
    }
    for (const e of edges) {
      push(this.out, e.from, e);
      push(this.in, e.to, e);
    }
  }

  get names(): NameIndex {
    this.nameIndex ??= new NameIndex(this.nodes);
    return this.nameIndex;
  }

  edgesFrom(id: string): Relation[] {
    return this.out.get(id) ?? [];
  }

  edgesTo(id: string): Relation[] {
    return this.in.get(id) ?? [];
  }

  /** Memoise a derived value for the lifetime of this graph load. */
  cached<T>(key: string, compute: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, compute());
    return this.memo.get(key) as T;
  }
}

function push(map: Map<string, Relation[]>, key: string, rel: Relation): void {
  const list = map.get(key);
  if (list) list.push(rel);
  else map.set(key, [rel]);
}

interface CacheEntry {
  fingerprint: string;
  view: Promise<GraphView>;
}

const cache = new WeakMap<GraphStore, CacheEntry>();

/** Get the (possibly cached) view of the current graph. */
export async function getGraphView(src: GraphViewSource): Promise<GraphView> {
  const fingerprint = await computeFingerprint(src);
  const hit = cache.get(src.graph);
  if (fingerprint !== null && hit && hit.fingerprint === fingerprint) return hit.view;

  const view = loadView(src);
  if (fingerprint !== null) {
    cache.set(src.graph, { fingerprint, view });
    view.catch(() => cache.delete(src.graph));
  }
  return view;
}

/** Drop the cached view for a store (e.g. after applying watch events in-process). */
export function invalidateGraphView(graph: GraphStore): void {
  cache.delete(graph);
}

async function loadView(src: GraphViewSource): Promise<GraphView> {
  const [nodes, edges, lastIndexed] = await Promise.all([
    src.graph.getAllNodes(),
    src.graph.getAllEdges(),
    getLastIndexed(src.fileIndexPath),
  ]);
  return new GraphView(nodes, edges, lastIndexed);
}

async function computeFingerprint(src: GraphViewSource): Promise<string | null> {
  if (src.graphVersion) return `v:${await src.graphVersion()}`;
  const dir = src.graphPath ?? join(src.flowlensDir, 'graph');
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return null; // not an on-disk store — don't cache
  }
  const parts = await Promise.all(
    [...names.map((n) => join(dir, n)), src.fileIndexPath].map(async (p) => {
      try {
        const s = await stat(p);
        return `${p}:${s.size}:${s.mtimeMs}`;
      } catch {
        return `${p}:-`;
      }
    }),
  );
  return parts.join('|');
}
