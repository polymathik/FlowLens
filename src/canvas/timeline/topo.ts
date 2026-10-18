/**
 * Link history on the map: which of today's edges existed at a commit, from
 * the sampled topology (file → file edges at ≤ 25 commits). A commit uses
 * the newest sample at or before it; before the first sample there is none.
 * Pure.
 */
import type { HistorySummary, HistoryTopology } from '../../contracts/history.js';
import { topologyDiff, type TopologyDiff } from '../../analysis/history/index.js';
import { chainOf, type ItemMap } from './items.js';

export interface TopoIndex {
  /** Commit index of each usable sample (ascending), and its position in `topology.samples`. */
  commit: number[];
  pos: number[];
}

export function indexTopology(history: Pick<HistorySummary, 'commits'>, topology: Pick<HistoryTopology, 'samples'>): TopoIndex {
  const at = new Map(history.commits.map((c, i) => [c.sha, i]));
  const rows = topology.samples.map((s, pos) => ({ commit: at.get(s.sha) ?? -1, pos })).filter((r) => r.commit >= 0);
  rows.sort((a, b) => a.commit - b.commit);
  return { commit: rows.map((r) => r.commit), pos: rows.map((r) => r.pos) };
}

/** Position in `topology.samples` of the newest sample at or before commit `index`; null before the first one. */
export function sampleFor(ti: TopoIndex, index: number): number | null {
  let lo = 0;
  let hi = ti.commit.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ti.commit[mid] <= index) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : ti.pos[lo - 1];
}

const SEP = '>';
export const edgeKey = (source: string, target: string): string => `${source}${SEP}${target}`;

/**
 * Weight of every displayed edge at one sample: a file → file edge counts for each pair of
 * (item of the source file, its ancestors) × (item of the target file, its ancestors), so card
 * edges, sibling edges and frame bundles are all found by their `source>target` key.
 */
export function aliveEdges(topology: Pick<HistoryTopology, 'files' | 'samples'>, samplePos: number, items: ItemMap): Map<string, number> {
  const sample = topology.samples[samplePos];
  const out = new Map<string, number>();
  if (!sample) return out;
  const chains = new Map<number, string[]>();
  const chain = (fileIdx: number): string[] => {
    let c = chains.get(fileIdx);
    if (!c) {
      const atom = items.atomOf.get(topology.files[fileIdx]);
      chains.set(fileIdx, (c = atom ? chainOf(items, atom) : []));
    }
    return c;
  };
  for (const [from, to, w] of sample.edges) {
    for (const s of chain(from)) for (const t of chain(to)) if (s !== t) out.set(edgeKey(s, t), (out.get(edgeKey(s, t)) ?? 0) + w);
  }
  return out;
}

export interface LinkDiff {
  added: number;
  removed: number;
  /** The samples the two commits resolved to (positions); equal when both fall between the same two samples. */
  from: number;
  to: number;
  diff: TopologyDiff;
}

/** Link change between commit `a` (older) and `b`, from their samples; null when either precedes the first sample. */
export function linkDiff(topology: HistoryTopology, ti: TopoIndex, a: number, b: number): LinkDiff | null {
  const from = sampleFor(ti, a);
  const to = sampleFor(ti, b);
  if (from === null || to === null) return null;
  const diff = topologyDiff(topology, from, to);
  return { added: diff.edges.added.length, removed: diff.edges.removed.length, from, to, diff };
}
