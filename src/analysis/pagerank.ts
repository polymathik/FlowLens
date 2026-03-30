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
  const d = options?.damping_factor ?? 0.85;
  const maxIter = options?.max_iterations ?? 100;
  const threshold = options?.convergence_threshold ?? 0.0001;

  const allNodes = await graph.getAllNodes();
  const allEdges = await graph.getAllEdges();
  const N = allNodes.length;
  if (N === 0) return new Map();

  // Build adjacency: inbound[nodeId] = [sourceIds], outDegree[nodeId] = count
  const inbound = new Map<string, string[]>();
  const outDegree = new Map<string, number>();

  for (const node of allNodes) {
    inbound.set(node.id, []);
    outDegree.set(node.id, 0);
  }

  for (const edge of allEdges) {
    if (inbound.has(edge.to)) {
      inbound.get(edge.to)!.push(edge.from);
    }
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
  }

  // Initialize ranks uniformly
  let ranks = new Map<string, number>();
  const initial = 1 / N;
  for (const node of allNodes) ranks.set(node.id, initial);

  // Iterate until convergence or max iterations
  for (let iter = 0; iter < maxIter; iter++) {
    // Compute dangling node contribution: nodes with no outgoing edges
    // would otherwise leak rank. Redistribute their rank evenly to all nodes.
    let danglingSum = 0;
    for (const node of allNodes) {
      if ((outDegree.get(node.id) ?? 0) === 0) {
        danglingSum += ranks.get(node.id) ?? 0;
      }
    }
    const danglingContrib = danglingSum / N;

    const newRanks = new Map<string, number>();
    let maxDelta = 0;

    for (const node of allNodes) {
      const incoming = inbound.get(node.id) ?? [];
      let sum = danglingContrib;
      for (const srcId of incoming) {
        const srcRank = ranks.get(srcId) ?? 0;
        const srcOut = outDegree.get(srcId) ?? 1;
        sum += srcRank / srcOut;
      }
      const newRank = (1 - d) / N + d * sum;
      newRanks.set(node.id, newRank);
      maxDelta = Math.max(maxDelta, Math.abs(newRank - (ranks.get(node.id) ?? 0)));
    }

    ranks = newRanks;
    if (maxDelta < threshold) break;
  }

  return ranks;
}
