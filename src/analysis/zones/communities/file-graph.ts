/**
 * buildFileGraph — turns relations into the undirected weighted file graph that community detection
 * partitions (`ZoningFileGraph`). Pure; the output is sorted, so it never depends on input order.
 *
 * Weights of one unordered pair of files (every distinct case counts once, not once per occurrence):
 *
 *   import (re-export barrels included)        1.0   per direction
 *   extend / implement / mixin / override      1.0   per direction
 *   call                                       0.5   per direction, however many calls
 *   same folder, no other tie                  0.3   only between clustered (source) files
 *
 * Other relation types (`use`, `create`, `parameter`, `return`, `throw`, `decorate`) are not counted:
 * they always come with an import, which is already the dependency. The sum of one pair is capped at 3.
 * Folders of more than `AFFINITY_MAX_FOLDER` files get no affinity (the clique would dominate the graph).
 */
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import type { Relation, RelationType } from '../../../contracts/relations.js';
import type { ZoningFileEdge, ZoningFileGraph } from '../../../contracts/zones.js';
import { compareText } from '../keys.js';
import { fileOfRef, treatmentOf } from './roles.js';

export const W_IMPORT = 1;
export const W_INHERIT = 1;
export const W_CALL = 0.5;
export const W_FOLDER = 0.3;
export const W_PAIR_CAP = 3;
export const AFFINITY_MAX_FOLDER = 80;

const INHERIT: ReadonlySet<RelationType> = new Set(['extend', 'implement', 'mixin', 'override']);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildFileGraph(h: Hierarchy, relations: readonly Relation[]): ZoningFileGraph {
  /** `from\u0000to\u0000class` → weight, one entry per distinct directed (file, file, class). */
  const seen = new Map<string, number>();
  for (const r of relations) {
    if (!r.to) continue;
    const cls = r.type === 'import' ? W_IMPORT : INHERIT.has(r.type) ? W_INHERIT : r.type === 'call' ? W_CALL : 0;
    if (cls === 0) continue;
    const a = fileOfRef(h, r.from);
    const b = fileOfRef(h, r.to);
    if (!a || !b || a === b) continue;
    seen.set(`${a}\u0000${b}\u0000${r.type === 'import' ? 'i' : r.type === 'call' ? 'c' : 'x'}`, cls);
  }

  const pairs = new Map<string, number>();
  for (const [key, w] of seen) {
    const [a, b] = key.split('\u0000');
    const k = cmp(a, b) < 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    pairs.set(k, Math.min(W_PAIR_CAP, (pairs.get(k) ?? 0) + w));
  }

  // Same-folder affinity between source files that have no tie at all.
  const byFolder = new Map<string, string[]>();
  for (const n of h.nodes.values()) {
    if (n.kind !== 'file' || n.parentId === null || treatmentOf(n) !== 'cluster') continue;
    const list = byFolder.get(n.parentId);
    if (list) list.push(n.id);
    else byFolder.set(n.parentId, [n.id]);
  }
  for (const files of byFolder.values()) {
    if (files.length < 2 || files.length > AFFINITY_MAX_FOLDER) continue;
    files.sort(cmp);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = `${files[i]}\u0000${files[j]}`;
        if (!pairs.has(k)) pairs.set(k, W_FOLDER);
      }
    }
  }

  const edges: ZoningFileEdge[] = [...pairs].map(([k, weight]) => {
    const [a, b] = k.split('\u0000');
    return { a, b, weight: Math.round(weight * 1000) / 1000 };
  });
  edges.sort((x, y) => compareText(x.a, y.a) || compareText(x.b, y.b) || cmp(x.a, y.a) || cmp(x.b, y.b));
  return { edges };
}
