/**
 * Seeded Leiden-style community detection (Traag, Waltman, van Eck 2019, "From Louvain to Leiden") on a
 * `WGraph`, with a resolution parameter gamma (Reichardt & Bornholdt 2006).
 *
 *   repeat: fast local moving (queue) → refine each community into well-connected sub-communities
 *           (greedy, deterministic) → aggregate on the REFINED partition, start the next level from the
 *           unrefined one → until every community is a single node or nothing shrinks.
 *
 * The refinement is what Louvain lacks: it keeps every community internally connected and well
 * connected, so a community never glues two unrelated halves together through one node.
 * All randomness comes from the injected generator (visiting order only); ties are broken by the lowest
 * community index, so the output depends on the seed and the graph — never on iteration accidents.
 */
import { aggregate, compact, type WGraph } from './wgraph.js';

const EPS = 1e-12;

export interface LeidenOptions {
  /** Resolution: higher gamma → more, smaller communities. 1 = plain modularity. */
  gamma: number;
  rnd: () => number;
  /** Starting partition of the nodes (any integer labels); default: every node alone. */
  initial?: ArrayLike<number>;
  /** Per node: extra gain a move away from the current community must beat (warm start stability). */
  stay?: Float64Array;
}

function shuffledOrder(n: number, rnd: () => number): Int32Array {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Move nodes between communities while the modularity gain is positive (queue based). `comm` holds labels
 * in 0..n-1 and is updated in place. Returns the number of moves.
 */
export function localMove(g: WGraph, comm: Int32Array, gamma: number, rnd: () => number, stay?: Float64Array): number {
  const n = g.n;
  if (g.m2 === 0) return 0;
  const tot = new Float64Array(n);
  const count = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    tot[comm[v]] += g.k[v];
    count[comm[v]]++;
  }
  const wc = new Float64Array(n);
  const touched: number[] = [];
  const queue = new Int32Array(n);
  const queued = new Uint8Array(n);
  let head = 0;
  let size = n;
  const order = shuffledOrder(n, rnd);
  for (let i = 0; i < n; i++) {
    queue[i] = order[i];
    queued[order[i]] = 1;
  }
  let emptyPtr = 0;
  let moves = 0;
  for (let guard = 0; size > 0 && guard < n * 60 + 1000; guard++) {
    const v = queue[head];
    head = (head + 1) % n;
    size--;
    queued[v] = 0;
    const c0 = comm[v];
    touched.length = 0;
    for (let i = g.start[v]; i < g.start[v + 1]; i++) {
      const c = comm[g.to[i]];
      if (wc[c] === 0) touched.push(c);
      wc[c] += g.w[i];
    }
    const kv = g.k[v];
    tot[c0] -= kv;
    count[c0]--;
    const gainOf = (c: number): number => wc[c] - (gamma * kv * tot[c]) / g.m2;
    const gainStay = gainOf(c0);
    let best = c0;
    let bestGain = gainStay + (stay ? stay[v] : 0);
    for (const c of touched) {
      if (c === c0) continue;
      const gain = gainOf(c);
      if (gain > bestGain + EPS || (best !== c0 && Math.abs(gain - bestGain) <= EPS && c < best)) {
        best = c;
        bestGain = gain;
      }
    }
    if (best === c0 && count[c0] > 0 && 0 > bestGain + EPS) {
      while (count[emptyPtr] > 0) emptyPtr++; // leaving for an empty community beats staying
      best = emptyPtr;
    }
    comm[v] = best;
    tot[best] += kv;
    count[best]++;
    if (count[c0] === 0 && c0 < emptyPtr) emptyPtr = c0;
    if (best !== c0) {
      moves++;
      for (let i = g.start[v]; i < g.start[v + 1]; i++) {
        const u = g.to[i];
        if (comm[u] !== best && queued[u] === 0) {
          queued[u] = 1;
          queue[(head + size) % n] = u;
          size++;
        }
      }
    }
    for (const c of touched) wc[c] = 0;
  }
  return moves;
}

/** Split every community into well-connected sub-communities (greedy merge of singletons, deterministic). */
export function refine(g: WGraph, comm: Int32Array, gamma: number, rnd: () => number): Int32Array {
  const n = g.n;
  const refined = new Int32Array(n);
  const rtot = Float64Array.from(g.k);
  const rext = new Float64Array(n); // weight from the refined community to the rest of its community
  const rcount = new Int32Array(n).fill(1);
  const ctot = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    refined[v] = v;
    ctot[comm[v]] += g.k[v];
    for (let i = g.start[v]; i < g.start[v + 1]; i++) if (comm[g.to[i]] === comm[v]) rext[v] += g.w[i];
  }
  const wr = new Float64Array(n);
  const touched: number[] = [];
  const connected = (ext: number, tot: number, c: number): boolean => ext >= (gamma * tot * (ctot[c] - tot)) / g.m2 - EPS;
  for (const v of shuffledOrder(n, rnd)) {
    if (rcount[refined[v]] !== 1) continue;
    const c = comm[v];
    if (!connected(rext[v], g.k[v], c)) continue;
    touched.length = 0;
    for (let i = g.start[v]; i < g.start[v + 1]; i++) {
      const u = g.to[i];
      if (comm[u] !== c) continue;
      const r = refined[u];
      if (wr[r] === 0) touched.push(r);
      wr[r] += g.w[i];
    }
    let best = -1;
    let bestGain = -Infinity;
    for (const r of touched) {
      if (r === refined[v] || !connected(rext[r], rtot[r], c)) continue;
      const gain = wr[r] - (gamma * g.k[v] * rtot[r]) / g.m2;
      if (gain >= -EPS && (gain > bestGain + EPS || (Math.abs(gain - bestGain) <= EPS && r < best))) {
        best = r;
        bestGain = gain;
      }
    }
    if (best >= 0) {
      const old = refined[v];
      rext[best] += rext[old] - 2 * wr[best];
      rtot[best] += g.k[v];
      rcount[best]++;
      rcount[old] = 0;
      refined[v] = best;
    }
    for (const r of touched) wr[r] = 0;
  }
  return refined;
}

/** Communities of the nodes of `g`, labels 0..K-1 numbered by first appearance. */
export function leiden(g: WGraph, opt: LeidenOptions): Int32Array {
  let cur = g;
  let comm = opt.initial ? compact(opt.initial).labels : Int32Array.from({ length: g.n }, (_, i) => i);
  let mapping = Int32Array.from({ length: g.n }, (_, i) => i);
  for (let level = 0; level < 40; level++) {
    localMove(cur, comm, opt.gamma, opt.rnd, level === 0 ? opt.stay : undefined);
    const packed = compact(comm);
    comm = packed.labels;
    if (packed.count === cur.n) break;
    const refined = compact(refine(cur, comm, opt.gamma, opt.rnd));
    if (refined.count === cur.n) break; // nothing could merge: aggregating would not shrink the graph
    const next = new Int32Array(refined.count);
    for (let v = 0; v < cur.n; v++) next[refined.labels[v]] = comm[v];
    mapping = mapping.map((x) => refined.labels[x]);
    cur = aggregate(cur, refined.labels, refined.count);
    comm = next;
  }
  return compact(mapping.map((x) => comm[x])).labels;
}
