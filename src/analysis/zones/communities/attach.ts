/**
 * Files that do not shape communities (tests, docs, assets, generated code, config below the root) join
 * the community of the files they depend on most — the strongest total edge weight — and, without any
 * tie, the community whose files share the longest folder prefix with them.
 */
import type { ZoningFileEdge } from '../../../contracts/zones.js';
import { dirSegments } from './naming.js';

export interface Leaf {
  key: string;
  ids: ReadonlySet<string>;
}

/** Edge weight of every file to its neighbours (all edges of the scope, in both directions). */
export function neighbourWeights(edges: readonly ZoningFileEdge[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, w: number): void => {
    let m = out.get(a);
    if (!m) out.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + w);
  };
  for (const e of edges) {
    add(e.a, e.b, e.weight);
    add(e.b, e.a, e.weight);
  }
  return out;
}

/** Index in `leaves` where `id` belongs (leaves must not be empty). */
export function leafFor(id: string, path: string, leaves: readonly Leaf[], ties: Map<string, number> | undefined, pathOf: (id: string) => string): number {
  let best = -1;
  let bestWeight = 0;
  leaves.forEach((leaf, i) => {
    let w = 0;
    if (ties) for (const [other, weight] of ties) if (leaf.ids.has(other)) w += weight;
    if (w > bestWeight + 1e-9 || (best >= 0 && Math.abs(w - bestWeight) <= 1e-9 && w > 0 && leaf.key < leaves[best].key)) {
      best = i;
      bestWeight = w;
    }
  });
  if (best >= 0) return best;
  const mine = dirSegments(path);
  let bestScore = -1;
  leaves.forEach((leaf, i) => {
    let top = 0;
    let hits = 0;
    for (const other of leaf.ids) {
      const d = dirSegments(pathOf(other));
      let n = 0;
      while (n < d.length && n < mine.length && d[n] === mine[n]) n++;
      if (n > top) [top, hits] = [n, 1];
      else if (n === top) hits++;
    }
    const score = top * 100000 + hits;
    if (score > bestScore || (score === bestScore && leaf.key < leaves[best].key)) [best, bestScore] = [i, score];
  });
  return best;
}
