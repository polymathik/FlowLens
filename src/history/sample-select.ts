/** Which commits to sample for the topology: evenly spaced, anchored at the oldest commit, plus HEAD. */
import { TOPOLOGY_DEFAULT_SAMPLES, TOPOLOGY_MAX_SAMPLES } from '../contracts/history.js';

export interface SamplePlan {
  /** Ascending commit indices; always starts at 0 and ends at `n - 1`. */
  indices: number[];
  /** Effective stride in commits. */
  every: number;
  /** The request asked for more samples than allowed and was thinned. */
  capped: boolean;
}

/** Multiples of `every` below n (index 0 included). One slot of `max` is kept free for HEAD. */
const multiples = (n: number, every: number): number => Math.floor((n - 1) / every) + 1;

/**
 * Anchoring the stride at index 0 (0, e, 2e, …) keeps samples stable while
 * history grows, so incremental builds reuse them; only the HEAD sample and
 * new multiples of `e` are new. The stride changes only when the multiples
 * alone would fill `max` (one slot stays free for HEAD).
 */
export function planSamples(n: number, o: { every?: number; max?: number } = {}): SamplePlan {
  if (n <= 0) return { indices: [], every: 1, capped: false };
  const max = Math.max(2, Math.min(TOPOLOGY_MAX_SAMPLES, Math.trunc(o.max ?? TOPOLOGY_DEFAULT_SAMPLES)));
  const asked = o.every !== undefined ? Math.max(1, Math.trunc(o.every)) : 1;
  let every = asked;
  while (every < Math.max(1, n - 1) && multiples(n, every) > max - 1) every++;
  const indices: number[] = [];
  for (let i = 0; i < n; i += every) indices.push(i);
  if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);
  return { indices, every, capped: o.every !== undefined && every > asked };
}

export interface SamplePick {
  /** Commit index to sample (or to take from the store). */
  index: number;
  reuse: boolean;
}

/**
 * Turn the plan into picks, preferring samples that are already stored.
 * Slot `p` takes a stored sample at most `⌊every/2⌋` commits away instead of
 * parsing a new commit, so a history that slides (the `max` window drops its
 * oldest commit with every new one) or grows still reuses almost everything.
 * HEAD is always exact. Spacing stays within one stride of even.
 */
export function pickSamples(plan: SamplePlan, storedIndices: ReadonlySet<number>): SamplePick[] {
  const tolerance = Math.floor(plan.every / 2);
  const used = new Set<number>();
  const picks: SamplePick[] = [];
  plan.indices.forEach((p, k) => {
    const isHead = k === plan.indices.length - 1;
    let best = -1;
    for (let d = 0; d <= (isHead ? 0 : tolerance) && best < 0; d++) {
      for (const j of d === 0 ? [p] : [p - d, p + d]) {
        if (storedIndices.has(j) && !used.has(j)) { best = j; break; }
      }
    }
    const index = best >= 0 ? best : p;
    if (used.has(index)) return;
    used.add(index);
    picks.push({ index, reuse: best >= 0 });
  });
  return picks.sort((a, b) => a.index - b.index);
}
