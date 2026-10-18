/**
 * Relation index of Focus mode: every structural relation resolved to hierarchy nodes and to the
 * FILE each end lives in, with lookups by file and by node. Built once per (hierarchy, relations)
 * pair and shared by every focus computation. Pure.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Relation } from '../../contracts/relations.js';
import { resolveRef } from '../../analysis/hierarchy/index.js';
import { pathOf } from '../utils/view-scope';

export interface IndexedRelation {
  r: Relation;
  /** Hierarchy node ids of both ends. */
  from: string;
  to: string;
  /** File node ids the ends live in (null for an end that is no file / symbol, e.g. a folder). */
  ff: string | null;
  tf: string | null;
}

export interface FocusIndex {
  rels: IndexedRelation[];
  /** File id → indices of the relations with an end in it. */
  byFile: Map<string, number[]>;
  /** Node id → indices of the relations with that exact node as an end. */
  byNode: Map<string, number[]>;
}

/** The file node a node belongs to (itself for a file), or null. */
export function fileOfNode(h: Hierarchy, id: string): string | null {
  if (h.nodes.get(id)?.kind === 'file') return id;
  return pathOf(h, id).find((p) => h.nodes.get(p)?.kind === 'file') ?? null;
}

const cache = new WeakMap<Relation[], { h: Hierarchy; index: FocusIndex }>();

function push(map: Map<string, number[]>, key: string, i: number): void {
  const list = map.get(key);
  if (list) {
    if (list[list.length - 1] !== i) list.push(i);
  } else map.set(key, [i]);
}

export function focusIndex(h: Hierarchy, relations: Relation[]): FocusIndex {
  const hit = cache.get(relations);
  if (hit && hit.h === h) return hit.index;
  const rels: IndexedRelation[] = [];
  const byFile = new Map<string, number[]>();
  const byNode = new Map<string, number[]>();
  const files = new Map<string, string | null>();
  const fileOf = (id: string) => {
    let f = files.get(id);
    if (f === undefined) files.set(id, (f = fileOfNode(h, id)));
    return f;
  };
  for (const r of relations) {
    if (r.type === 'contain' || !r.to) continue;
    const from = resolveRef(h, r.from);
    const to = resolveRef(h, r.to);
    if (!from || !to) continue;
    const i = rels.length;
    const ir: IndexedRelation = { r, from, to, ff: fileOf(from), tf: fileOf(to) };
    rels.push(ir);
    push(byNode, from, i);
    push(byNode, to, i);
    if (ir.ff) push(byFile, ir.ff, i);
    if (ir.tf) push(byFile, ir.tf, i);
  }
  const index = { rels, byFile, byNode };
  cache.set(relations, { h, index });
  return index;
}
