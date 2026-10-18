import type { GraphStore } from '../contracts/graph.js';

export interface PageRankOptions {
  damping_factor?: number;        // default 0.85
  max_iterations?: number;        // default 100
  convergence_threshold?: number; // default 0.0001
}

/**
 * Computes PageRank for all entities in the graph.
 *
 * Uses the standard iterative formula:
 *   PR(A) = (1 - d) / N + d × Σ(PR(Ti) / C(Ti))
 *
 * Where d is the damping factor, N is total node count,
 * Ti are nodes linking TO A, and C(Ti) is Ti's out-degree.
 *
 * Iteration stops when max rank delta < convergence_threshold
 * or max_iterations is reached.
 */
export async function computePageRank(
  graph: GraphStore,
  options?: PageRankOptions,
): Promise<Map<string, number>> {
  const [allNodes, allEdges] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const adjacency = new Map<string, string[]>();
  for (const node of allNodes) adjacency.set(node.id, []);
  for (const edge of allEdges) {
    // Edges from unknown sources still count towards out-degree (as before),
    // but only known nodes receive rank.
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }
  const known = new Set(allNodes.map((n) => n.id));
  return computePageRankOnAdjacency(adjacency, options, known);
}

/**
 * PageRank over an arbitrary adjacency list (used for collapsed file/module
 * graphs in cycle severity). Duplicate targets count as parallel edges.
 * `nodes` limits which ids receive rank (defaults to every adjacency key).
 */
export function computePageRankOnAdjacency(
  adjacency: Map<string, Iterable<string>>,
  options?: PageRankOptions,
  nodes?: Set<string>,
): Map<string, number> {
  const d = options?.damping_factor ?? 0.85;
  const maxIter = options?.max_iterations ?? 100;
  const threshold = options?.convergence_threshold ?? 0.0001;

  const ids = [...(nodes ?? adjacency.keys())];
  const N = ids.length;
  if (N === 0) return new Map();

  const inbound = new Map<string, string[]>(ids.map((id) => [id, []]));
  const outDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      inbound.get(to)?.push(from);
      outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    }
  }

  let ranks = new Map<string, number>(ids.map((id) => [id, 1 / N]));

  for (let iter = 0; iter < maxIter; iter++) {
    // Dangling nodes (no outgoing edges) redistribute their rank evenly.
    let danglingSum = 0;
    for (const id of ids) {
      if ((outDegree.get(id) ?? 0) === 0) danglingSum += ranks.get(id) ?? 0;
    }
    const danglingContrib = danglingSum / N;

    const newRanks = new Map<string, number>();
    let maxDelta = 0;
    for (const id of ids) {
      let sum = danglingContrib;
      for (const src of inbound.get(id)!) {
        sum += (ranks.get(src) ?? 0) / (outDegree.get(src) ?? 1);
      }
      const rank = (1 - d) / N + d * sum;
      newRanks.set(id, rank);
      maxDelta = Math.max(maxDelta, Math.abs(rank - (ranks.get(id) ?? 0)));
    }

    ranks = newRanks;
    if (maxDelta < threshold) break;
  }

  return ranks;
}
