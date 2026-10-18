import { describe, it, expect } from 'vitest';
import { leiden, localMove, refine } from '../../../../src/analysis/zones/communities/leiden.js';
import { seededRandom } from '../../../../src/analysis/zones/communities/rng.js';
import { buildWGraph, compact, type Edge3 } from '../../../../src/analysis/zones/communities/wgraph.js';

/** `cliques` cliques of `size` nodes (weight 1) joined in a ring by single weak bridges. */
function ring(cliques: number, size: number, bridge = 0.2): { edges: Edge3[]; n: number } {
  const edges: Edge3[] = [];
  for (let c = 0; c < cliques; c++) {
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) edges.push([c * size + i, c * size + j, 1]);
    edges.push([c * size, ((c + 1) % cliques) * size + 1, bridge]);
  }
  return { edges, n: cliques * size };
}

const groups = (labels: Int32Array): number[][] => {
  const m = new Map<number, number[]>();
  labels.forEach((c, i) => m.set(c, [...(m.get(c) ?? []), i]));
  return [...m.values()];
};

describe('leiden', () => {
  it('recovers planted cliques', () => {
    const { edges, n } = ring(5, 6);
    const labels = leiden(buildWGraph(n, edges), { gamma: 1, rnd: seededRandom(1) });
    const gs = groups(labels);
    expect(gs).toHaveLength(5);
    for (const g of gs) expect(new Set(g.map((i) => Math.floor(i / 6))).size).toBe(1);
  });

  it('is deterministic for a seed and varies the search (not the answer) between seeds on clear structure', () => {
    const { edges, n } = ring(6, 5);
    const g = buildWGraph(n, edges);
    const a = leiden(g, { gamma: 1, rnd: seededRandom(42) });
    expect(Array.from(leiden(g, { gamma: 1, rnd: seededRandom(42) }))).toEqual(Array.from(a));
    expect(groups(leiden(g, { gamma: 1, rnd: seededRandom(7) }))).toHaveLength(6);
  });

  it('returns connected communities (the Leiden guarantee) on a messy random graph', () => {
    const rnd = seededRandom(3);
    const edges: Edge3[] = [];
    for (let i = 0; i < 80; i++) for (let k = 0; k < 3; k++) edges.push([i, Math.floor(rnd() * 80), 0.3 + rnd()]);
    const g = buildWGraph(80, edges.filter(([a, b]) => a !== b));
    const labels = leiden(g, { gamma: 1.3, rnd: seededRandom(9) });
    for (const comm of groups(labels)) {
      const inComm = new Set(comm);
      const seen = new Set([comm[0]]);
      const stack = [comm[0]];
      while (stack.length > 0) {
        const v = stack.pop()!;
        for (let i = g.start[v]; i < g.start[v + 1]; i++) if (inComm.has(g.to[i]) && !seen.has(g.to[i])) (seen.add(g.to[i]), stack.push(g.to[i]));
      }
      expect(seen.size).toBe(comm.length);
    }
  });

  it('splits more as the resolution grows', () => {
    const { edges, n } = ring(4, 8, 2.5);
    const g = buildWGraph(n, edges);
    const low = groups(leiden(g, { gamma: 0.3, rnd: seededRandom(1) })).length;
    const high = groups(leiden(g, { gamma: 4, rnd: seededRandom(1) })).length;
    expect(high).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThan(4);
  });

  it('handles graphs without edges and a single node', () => {
    expect(Array.from(leiden(buildWGraph(3, []), { gamma: 1, rnd: seededRandom(1) }))).toEqual([0, 1, 2]);
    expect(Array.from(leiden(buildWGraph(1, []), { gamma: 1, rnd: seededRandom(1) }))).toEqual([0]);
  });

  it('local moving: a stay bonus keeps a node in its community, a larger gain moves it', () => {
    // node 0 sits in community A but is tied slightly more to community B
    const edges: Edge3[] = [[0, 1, 1], [0, 2, 1], [1, 2, 1], [0, 3, 1.9], [0, 4, 1.9], [3, 4, 1], [3, 5, 1], [4, 5, 1]];
    const g = buildWGraph(6, edges);
    const init = Int32Array.from([0, 0, 0, 1, 1, 1]);
    const stay = new Float64Array(6).fill(0.6);
    const sticky = Int32Array.from(init);
    localMove(g, sticky, 1, seededRandom(1), stay);
    expect(sticky[0]).toBe(0);
    const free = Int32Array.from(init);
    localMove(g, free, 1, seededRandom(1));
    expect(free[0]).toBe(free[3]);
  });

  it('refinement only merges inside a community', () => {
    const { edges, n } = ring(3, 5);
    const g = buildWGraph(n, edges);
    const comm = Int32Array.from({ length: n }, (_, i) => Math.floor(i / 10)); // two cliques glued per community
    const refined = refine(g, comm, 1, seededRandom(2));
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) if (refined[v] === refined[u]) expect(comm[v]).toBe(comm[u]);
    expect(compact(refined).count).toBeGreaterThanOrEqual(compact(comm).count);
  });
});
