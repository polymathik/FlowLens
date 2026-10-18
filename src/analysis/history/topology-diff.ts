/**
 * What changed between two sampled topologies: files and file-to-file
 * edges added, removed, or re-weighted. Pure (no `node:*`).
 */
import type { HistoryTopology, HistoryTopologySample } from '../../contracts/history.js';

export interface TopologyEdge {
  from: string;
  to: string;
  weight: number;
}

export interface TopologyDiff {
  files: { added: string[]; removed: string[] };
  edges: {
    added: TopologyEdge[];
    removed: TopologyEdge[];
    /** Same edge on both sides with a different weight (`weight` = new, `was` = old). */
    changed: Array<TopologyEdge & { was: number }>;
  };
}

/** A sample of `topology`, given as the sample itself, its position, or its (prefix of its) sha. */
export type SampleRef = HistoryTopologySample | number | string;

export function resolveSample(topology: Pick<HistoryTopology, 'samples'>, ref: SampleRef): HistoryTopologySample | null {
  if (typeof ref === 'number') return topology.samples[ref] ?? null;
  if (typeof ref === 'string') return topology.samples.find((s) => s.sha === ref || (ref.length >= 7 && s.sha.startsWith(ref))) ?? null;
  return ref;
}

const SEP = '\u0000';

function expand(files: string[], s: HistoryTopologySample): { files: Set<string>; edges: Map<string, number> } {
  const edges = new Map<string, number>();
  for (const [a, b, w] of s.edges) {
    const key = `${files[a]}${SEP}${files[b]}`;
    edges.set(key, (edges.get(key) ?? 0) + w);
  }
  return { files: new Set(s.files.map((i) => files[i])), edges };
}

const edgeOf = (key: string, weight: number): TopologyEdge => {
  const [from, to] = key.split(SEP);
  return { from, to, weight };
};

/** Diff `a` (older) → `b` (newer). Throws `RangeError` when a reference is not a sample of `topology`. */
export function topologyDiff(topology: Pick<HistoryTopology, 'files' | 'samples'>, a: SampleRef, b: SampleRef): TopologyDiff {
  const sa = resolveSample(topology, a);
  const sb = resolveSample(topology, b);
  if (!sa || !sb) throw new RangeError('topologyDiff: unknown sample');
  const A = expand(topology.files, sa);
  const B = expand(topology.files, sb);
  const diff: TopologyDiff = { files: { added: [], removed: [] }, edges: { added: [], removed: [], changed: [] } };
  for (const f of B.files) if (!A.files.has(f)) diff.files.added.push(f);
  for (const f of A.files) if (!B.files.has(f)) diff.files.removed.push(f);
  for (const [k, w] of B.edges) {
    const was = A.edges.get(k);
    if (was === undefined) diff.edges.added.push(edgeOf(k, w));
    else if (was !== w) diff.edges.changed.push({ ...edgeOf(k, w), was });
  }
  for (const [k, w] of A.edges) if (!B.edges.has(k)) diff.edges.removed.push(edgeOf(k, w));
  diff.files.added.sort();
  diff.files.removed.sort();
  const byEdge = (x: TopologyEdge, y: TopologyEdge): number => x.from.localeCompare(y.from) || x.to.localeCompare(y.to);
  diff.edges.added.sort(byEdge);
  diff.edges.removed.sort(byEdge);
  diff.edges.changed.sort(byEdge);
  return diff;
}
