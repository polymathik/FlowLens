/**
 * Compact undirected weighted graph (CSR arrays) for the community search.
 *
 * Conventions (Newman modularity): `k[v]` is the strength of a node — the sum of its edge weights plus
 * twice its self loop; `m2` is the sum of all strengths (= 2m). `self[v]` is the weight of the loop
 * itself (internal weight of an aggregated node), counted once.
 */
export interface WGraph {
  n: number;
  /** Neighbours of v are `to[start[v] .. start[v+1])`, sorted by index (deterministic iteration). */
  start: Int32Array;
  to: Int32Array;
  w: Float64Array;
  k: Float64Array;
  self: Float64Array;
  m2: number;
}

export type Edge3 = readonly [number, number, number];

/** Build from edges `[a, b, weight]` (a != b; duplicates are summed) and optional self-loop weights. */
export function buildWGraph(n: number, edges: readonly Edge3[], self?: Float64Array): WGraph {
  const rows: Array<Map<number, number>> = Array.from({ length: n }, () => new Map<number, number>());
  for (const [a, b, w] of edges) {
    if (a === b || w <= 0) continue;
    rows[a].set(b, (rows[a].get(b) ?? 0) + w);
    rows[b].set(a, (rows[b].get(a) ?? 0) + w);
  }
  const start = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = start[v] + rows[v].size;
  const to = new Int32Array(start[n]);
  const w = new Float64Array(start[n]);
  const k = new Float64Array(n);
  const loops = self ? Float64Array.from(self) : new Float64Array(n);
  let m2 = 0;
  for (let v = 0; v < n; v++) {
    let i = start[v];
    for (const u of [...rows[v].keys()].sort((x, y) => x - y)) {
      to[i] = u;
      w[i] = rows[v].get(u)!;
      k[v] += w[i];
      i++;
    }
    k[v] += 2 * loops[v];
    m2 += k[v];
  }
  return { n, start, to, w, k, self: loops, m2 };
}

/** Relabel to 0..K-1 in order of first appearance; returns the labels and K. */
export function compact(labels: ArrayLike<number>): { labels: Int32Array; count: number } {
  const map = new Map<number, number>();
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    let c = map.get(labels[i]);
    if (c === undefined) map.set(labels[i], (c = map.size));
    out[i] = c;
  }
  return { labels: out, count: map.size };
}

/** Collapse each label into one node: edges between labels are summed, internal weight becomes a self loop. */
export function aggregate(g: WGraph, labels: Int32Array, count: number): WGraph {
  const self = new Float64Array(count);
  const acc = new Map<number, number>();
  for (let v = 0; v < g.n; v++) {
    self[labels[v]] += g.self[v];
    for (let i = g.start[v]; i < g.start[v + 1]; i++) {
      const u = g.to[i];
      if (u < v) continue; // each undirected edge once
      const a = labels[v];
      const b = labels[u];
      if (a === b) self[a] += g.w[i];
      else {
        const key = a < b ? a * count + b : b * count + a;
        acc.set(key, (acc.get(key) ?? 0) + g.w[i]);
      }
    }
  }
  const edges: Edge3[] = [...acc].map(([key, w]) => [Math.floor(key / count), key % count, w]);
  return buildWGraph(count, edges, self);
}
