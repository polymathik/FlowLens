/**
 * Tarjan's Strongly Connected Components algorithm (iterative).
 *
 * Operates on an adjacency list (Map<nodeId, Set<nodeId>>) and returns all
 * SCCs with size > 1 (i.e., actual cycles). Uses an explicit call stack so
 * long dependency chains (tens of thousands of nodes) cannot overflow the
 * JavaScript stack.
 */

interface TarjanNode {
  index: number;
  lowlink: number;
  onStack: boolean;
}

interface Frame {
  node: string;
  neighbors: Iterator<string>;
}

export function findStronglyConnectedComponents(
  adjacency: Map<string, Set<string>>,
): string[][] {
  let index = 0;
  const stack: string[] = [];
  const info = new Map<string, TarjanNode>();
  const sccs: string[][] = [];
  const empty = new Set<string>();

  const visit = (v: string, callStack: Frame[]): void => {
    info.set(v, { index, lowlink: index, onStack: true });
    index++;
    stack.push(v);
    callStack.push({ node: v, neighbors: (adjacency.get(v) ?? empty)[Symbol.iterator]() });
  };

  for (const root of adjacency.keys()) {
    if (info.has(root)) continue;
    const callStack: Frame[] = [];
    visit(root, callStack);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const vInfo = info.get(frame.node)!;
      const next = frame.neighbors.next();

      if (!next.done) {
        const w = next.value;
        const wInfo = info.get(w);
        if (wInfo === undefined) {
          visit(w, callStack); // "recurse"
        } else if (wInfo.onStack) {
          vInfo.lowlink = Math.min(vInfo.lowlink, wInfo.index);
        }
        continue;
      }

      // All neighbours done: "return" to the caller.
      callStack.pop();
      if (callStack.length > 0) {
        const parent = info.get(callStack[callStack.length - 1].node)!;
        parent.lowlink = Math.min(parent.lowlink, vInfo.lowlink);
      }

      if (vInfo.lowlink === vInfo.index) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          info.get(w)!.onStack = false;
          scc.push(w);
        } while (w !== frame.node);
        if (scc.length > 1) sccs.push(scc);
      }
    }
  }

  return sccs;
}
