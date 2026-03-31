/**
 * Tarjan's Strongly Connected Components algorithm.
 *
 * Operates on an adjacency list (Map<nodeId, Set<nodeId>>)
 * and returns all SCCs with size > 1 (i.e., actual cycles).
 */

interface TarjanNode {
  index: number;
  lowlink: number;
  onStack: boolean;
}

export function findStronglyConnectedComponents(
  adjacency: Map<string, Set<string>>,
): string[][] {
  let index = 0;
  const stack: string[] = [];
  const nodeInfo = new Map<string, TarjanNode>();
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    const vInfo: TarjanNode = { index, lowlink: index, onStack: true };
    nodeInfo.set(v, vInfo);
    index++;
    stack.push(v);

    const neighbors = adjacency.get(v);
    if (neighbors) {
      for (const w of neighbors) {
        const wInfo = nodeInfo.get(w);
        if (wInfo === undefined) {
          // w has not been visited; recurse
          strongConnect(w);
          const wInfoAfter = nodeInfo.get(w)!;
          vInfo.lowlink = Math.min(vInfo.lowlink, wInfoAfter.lowlink);
        } else if (wInfo.onStack) {
          // w is on the stack — part of current SCC
          vInfo.lowlink = Math.min(vInfo.lowlink, wInfo.index);
        }
      }
    }

    // If v is a root node, pop the stack to form an SCC
    if (vInfo.lowlink === vInfo.index) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        nodeInfo.get(w)!.onStack = false;
        scc.push(w);
      } while (w !== v);

      // Only keep SCCs with more than one node (actual cycles)
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  // Visit all nodes in the adjacency list
  for (const node of adjacency.keys()) {
    if (!nodeInfo.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}
