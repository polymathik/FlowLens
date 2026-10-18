/**
 * Extract an actual, ordered cycle from a strongly connected component.
 *
 * Tarjan gives the members of an SCC but not a walk; agents and the CLI need
 * the real edge sequence ("a -> b -> c -> a"). We BFS from a start member,
 * restricted to SCC members, back to the start: the result is a shortest
 * simple cycle through that member (it need not visit every member).
 */

export function shortestCycleThrough(
  start: string,
  members: Set<string>,
  adjacency: Map<string, Set<string>>,
): string[] {
  const parent = new Map<string, string>();
  const queue: string[] = [];
  for (const next of sortedNeighbors(start, members, adjacency)) {
    if (next === start) return [start, start];
    if (!parent.has(next)) {
      parent.set(next, start);
      queue.push(next);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    for (const next of sortedNeighbors(node, members, adjacency)) {
      if (next === start) return unwind(node, start, parent);
      if (!parent.has(next)) {
        parent.set(next, node);
        queue.push(next);
      }
    }
  }
  // Not reachable for a genuine SCC; fall back to the member list.
  return [...members, start];
}

function sortedNeighbors(node: string, members: Set<string>, adjacency: Map<string, Set<string>>): string[] {
  return [...(adjacency.get(node) ?? [])].filter((n) => members.has(n)).sort();
}

function unwind(last: string, start: string, parent: Map<string, string>): string[] {
  const reversed = [start, last];
  let cur = last;
  while (parent.get(cur) !== start) {
    cur = parent.get(cur)!;
    reversed.push(cur);
  }
  reversed.push(start);
  return reversed.reverse();
}
