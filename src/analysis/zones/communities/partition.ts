/**
 * One clustering level: split a set of files into communities of the target size (5–40 files).
 *
 *  - cold start: Leiden at several resolutions; the one whose communities best fit the size window
 *    wins (see `scoreOf`) — the way to dodge the resolution limit of plain modularity, which merges
 *    small clusters into big ones (Fortunato & Barthélemy 2007);
 *  - warm start: begin from the previous partition and only re-optimise: new files join the community
 *    where most of their weight is, existing files move only when the gain beats a stay bonus;
 *  - then: split disconnected pieces, merge communities below the minimum into their strongest neighbour.
 */
import type { ZoningFileEdge } from '../../../contracts/zones.js';
import { buildWGraph, compact, type Edge3, type WGraph } from './wgraph.js';
import { leiden, localMove } from './leiden.js';
import { seededRandom } from './rng.js';

export const MIN_ZONE = 5;
export const MAX_ZONE = 40;
/** Merge slack: a tiny community may push its neighbour a little over the maximum rather than stay alone. */
const MERGE_SLACK = 8;
/** Resolutions tried by the cold start (document: raise gamma → more, smaller communities). */
export const GAMMAS: readonly number[] = [0.6, 0.8, 1, 1.3, 1.7, 2.3, 3.2, 4.5];
/** Gain a node must win by to leave its community on a warm start, in edge-weight units (an import is 1). */
export const STAY_BONUS = 0.6;

export interface LevelInput {
  /** Sorted node ids (hierarchy file ids). */
  ids: string[];
  /** Edges between the ids (both ends must be in `ids`). */
  edges: ZoningFileEdge[];
  seed: number;
  /** Previous label per id (aligned with `ids`), when warm starting. */
  prev?: Array<string | undefined>;
  /** The caller needs at least two communities (a split of an oversized zone). */
  needSplit?: boolean;
}

export interface LevelResult {
  /** Communities as sorted id lists, ordered by their first id. */
  groups: string[][];
  /** Files without any edge here: the caller places them by folder proximity. */
  loose: string[];
  gamma: number;
  warm: boolean;
}

function modularity(g: WGraph, labels: Int32Array, count: number): number {
  if (g.m2 === 0) return 0;
  const inside = new Float64Array(count);
  const tot = new Float64Array(count);
  for (let v = 0; v < g.n; v++) {
    tot[labels[v]] += g.k[v];
    inside[labels[v]] += g.self[v];
    for (let i = g.start[v]; i < g.start[v + 1]; i++) if (g.to[i] > v && labels[g.to[i]] === labels[v]) inside[labels[v]] += g.w[i];
  }
  let q = 0;
  for (let c = 0; c < count; c++) q += (2 * inside[c]) / g.m2 - (tot[c] / g.m2) ** 2;
  return q;
}

/** Higher is better: share of files in communities inside the size window, plus a modularity tie-breaker. */
function scoreOf(g: WGraph, labels: Int32Array, count: number): number {
  const sizes = new Int32Array(count);
  for (const c of labels) sizes[c]++;
  let good = 0;
  for (const s of sizes) if (s >= MIN_ZONE && s <= MAX_ZONE) good += s;
  return good / g.n + 0.25 * modularity(g, labels, count);
}

/** Split every community into its connected components (a community can lose its bridge in a warm start). */
function connectedPieces(g: WGraph, labels: Int32Array): Int32Array {
  const out = new Int32Array(g.n).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < g.n; s++) {
    if (out[s] >= 0) continue;
    out[s] = next;
    stack.push(s);
    while (stack.length > 0) {
      const v = stack.pop()!;
      for (let i = g.start[v]; i < g.start[v + 1]; i++) {
        const u = g.to[i];
        if (out[u] < 0 && labels[u] === labels[s]) {
          out[u] = next;
          stack.push(u);
        }
      }
    }
    next++;
  }
  return out;
}

/** Merge communities below `MIN_ZONE` into the neighbour they are most tied to (isolated ones stay). */
function mergeTiny(g: WGraph, start: Int32Array): Int32Array {
  const labels = Int32Array.from(start);
  for (let guard = 0; guard < g.n; guard++) {
    const sizes = new Map<number, number>();
    for (const c of labels) sizes.set(c, (sizes.get(c) ?? 0) + 1);
    const tiny = [...sizes].filter(([, s]) => s < MIN_ZONE).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let merged = false;
    for (const [t, ts] of tiny) {
      const inter = new Map<number, number>();
      for (let v = 0; v < g.n; v++) {
        if (labels[v] !== t) continue;
        for (let i = g.start[v]; i < g.start[v + 1]; i++) {
          const c = labels[g.to[i]];
          if (c !== t) inter.set(c, (inter.get(c) ?? 0) + g.w[i]);
        }
      }
      const ranked = [...inter].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
      const pick = (limit: number): number | undefined => ranked.find((c) => ts + sizes.get(c)! <= limit);
      const target = pick(MAX_ZONE) ?? pick(MAX_ZONE + MERGE_SLACK);
      if (target === undefined) continue;
      for (let v = 0; v < g.n; v++) if (labels[v] === t) labels[v] = target;
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return compact(labels).labels;
}

function bestCold(g: WGraph, seed: number, needSplit: boolean): { labels: Int32Array; gamma: number } {
  let best: { labels: Int32Array; gamma: number; score: number } | null = null;
  GAMMAS.forEach((gamma, i) => {
    const raw = leiden(g, { gamma, rnd: seededRandom(seed + i * 7919) });
    const labels = mergeTiny(g, connectedPieces(g, raw));
    const count = compact(labels).count;
    if (needSplit && count < 2) return;
    const score = scoreOf(g, labels, count);
    if (!best || score > best.score + 1e-9) best = { labels, gamma, score };
  });
  const found = best as { labels: Int32Array; gamma: number } | null;
  return found ?? { labels: new Int32Array(g.n), gamma: GAMMAS[0] };
}

/** The resolution at which the previous partition is closest to a local optimum (fewest moves). */
function fitGamma(g: WGraph, init: Int32Array, seed: number): number {
  let best = GAMMAS[0];
  let fewest = Infinity;
  for (const gamma of GAMMAS) {
    const trial = Int32Array.from(init);
    const moves = localMove(g, trial, gamma, seededRandom(seed), undefined);
    if (moves < fewest) {
      fewest = moves;
      best = gamma;
    }
  }
  return best;
}

export function clusterLevel(input: LevelInput): LevelResult {
  const { ids, edges } = input;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const triples: Edge3[] = [];
  const degree = new Uint8Array(ids.length);
  for (const e of edges) {
    const a = idx.get(e.a);
    const b = idx.get(e.b);
    if (a === undefined || b === undefined || a === b || e.weight <= 0) continue;
    triples.push([a, b, e.weight]);
    degree[a] = degree[b] = 1;
  }
  const kept = ids.map((_, i) => i).filter((i) => degree[i] === 1);
  const loose = ids.filter((_, i) => degree[i] === 0);
  if (kept.length === 0) return { groups: [], loose, gamma: GAMMAS[0], warm: false };
  const local = new Map(kept.map((orig, i) => [orig, i]));
  const g = buildWGraph(kept.length, triples.map(([a, b, w]) => [local.get(a)!, local.get(b)!, w] as Edge3));

  const prev = input.prev ? kept.map((i) => input.prev![i]) : undefined;
  const known = prev ? prev.filter((p) => p !== undefined).length : 0;
  let labels: Int32Array;
  let gamma: number;
  const warm = prev !== undefined && known >= kept.length / 2;
  if (warm && prev) {
    const names = [...new Set(prev.filter((p): p is string => p !== undefined))].sort();
    const of = new Map(names.map((n, i) => [n, i]));
    const init = Int32Array.from(prev, (p, i) => (p === undefined ? names.length + i : of.get(p)!));
    const packed = compact(init).labels;
    gamma = fitGamma(g, packed, input.seed);
    const stay = Float64Array.from(prev, (p) => (p === undefined ? 0 : STAY_BONUS));
    labels = Int32Array.from(packed);
    localMove(g, labels, gamma, seededRandom(input.seed), stay);
    labels = mergeTiny(g, connectedPieces(g, labels));
    if (input.needSplit && compact(labels).count < 2) ({ labels, gamma } = bestCold(g, input.seed, true));
  } else {
    ({ labels, gamma } = bestCold(g, input.seed, input.needSplit === true));
  }

  const buckets = new Map<number, string[]>();
  labels.forEach((c, i) => {
    const list = buckets.get(c);
    const id = ids[kept[i]];
    if (list) list.push(id);
    else buckets.set(c, [id]);
  });
  const groups = [...buckets.values()].map((l) => l.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { groups, loose, gamma, warm };
}
