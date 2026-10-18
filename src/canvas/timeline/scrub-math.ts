/**
 * Geometry of the timeline: where each commit sits on the horizontal axis,
 * the inverse (pointer → commit), the commit-density histogram, date ticks
 * and the down-sampling of long series for the charts. Pure.
 *
 * Two axes: `time` (true dates; bursts of commits share a few pixels) and
 * `commit` (one equal step per commit; dates become uneven ticks). Both map
 * a commit index to a fraction in [0, 1] — everything else only sees that.
 */
import type { HistoryCommit } from '../../contracts/history.js';

export type AxisMode = 'time' | 'commit';

export const timeOf = (c: Pick<HistoryCommit, 'date'>): number => {
  const t = Date.parse(c.date);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Fraction in [0, 1] of every commit. Commit times are made non-decreasing first
 * (rebased history can have older committer dates after newer ones).
 */
export function axisPositions(commits: ReadonlyArray<Pick<HistoryCommit, 'date'>>, mode: AxisMode): number[] {
  const n = commits.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const byCommit = commits.map((_, i) => i / (n - 1));
  if (mode === 'commit') return byCommit;
  const times: number[] = [];
  let prev = -Infinity;
  for (const c of commits) times.push((prev = Math.max(prev, timeOf(c))));
  const span = times[n - 1] - times[0];
  return span > 0 ? times.map((t) => (t - times[0]) / span) : byCommit;
}

/**
 * Which axis reads better: `time` unless most commits cluster in a small part of the span (a repository
 * built in a few bursts), where dates would squeeze them into a few pixels and `commit` spreads them out.
 */
export function suggestAxis(commits: ReadonlyArray<Pick<HistoryCommit, 'date'>>): AxisMode {
  const p = axisPositions(commits, 'time');
  if (p.length < 8) return 'time';
  const buckets = density(p, 20);
  return Math.max(...buckets) / p.length > 0.55 ? 'commit' : 'time';
}

/** Index of the commit nearest to fraction `f` (positions ascending). */
export function indexAtFraction(positions: readonly number[], f: number): number {
  const n = positions.length;
  if (n === 0) return 0;
  const x = Math.max(0, Math.min(1, f));
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(positions[lo - 1] - x) <= Math.abs(positions[lo] - x)) return lo - 1;
  return lo;
}

/** Fraction of pointer `clientX` inside a box. */
export const fractionOf = (clientX: number, left: number, width: number): number => (width > 0 ? Math.max(0, Math.min(1, (clientX - left) / width)) : 0);

/** Commits per bucket across the axis (the sparkline). */
export function density(positions: readonly number[], buckets: number): number[] {
  const out = new Array<number>(Math.max(1, buckets)).fill(0);
  for (const p of positions) out[Math.min(out.length - 1, Math.floor(p * out.length))]++;
  return out;
}

/**
 * At most `max` indices (always including the first and last) chosen so that each pixel column
 * keeps its newest commit — a series with thousands of commits draws as a few hundred points.
 */
export function sampleIndices(positions: readonly number[], max: number): number[] {
  const n = positions.length;
  if (n <= max) return positions.map((_, i) => i);
  const picked: number[] = [];
  let lastBucket = -1;
  for (let i = 0; i < n; i++) {
    const bucket = Math.min(max - 1, Math.floor(positions[i] * max));
    if (bucket === lastBucket) picked[picked.length - 1] = i;
    else picked.push(i);
    lastBucket = bucket;
  }
  if (picked[0] !== 0) picked.unshift(0);
  return picked;
}

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const tickLabel = (unit: 'day' | 'month' | 'year', y: number, m: number, d: number, first: boolean): string =>
  unit === 'day' ? `${MONTHS[m]} ${d}` : unit === 'year' ? String(y) : first || m === 0 ? `${MONTHS[m]} ’${String(y).slice(2)}` : MONTHS[m];

export interface DateTick {
  frac: number;
  label: string;
}

/** Month starts (or day / year starts for very short / long spans) as ticks, labelled, at most `max` of them. UTC. */
export function dateTicks(commits: ReadonlyArray<Pick<HistoryCommit, 'date'>>, positions: readonly number[], max: number): DateTick[] {
  const n = commits.length;
  if (n < 2) return [];
  const times = commits.map(timeOf);
  const t0 = times[0];
  const t1 = Math.max(...times);
  if (t1 <= t0) return [];
  const spanDays = (t1 - t0) / DAY;
  const unit: 'day' | 'month' | 'year' = spanDays <= 14 ? 'day' : spanDays > 365 * 6 ? 'year' : 'month';
  const starts: Array<{ t: number; label: string }> = [];
  const first = new Date(t0);
  let y = first.getUTCFullYear();
  let m = unit === 'year' ? 0 : first.getUTCMonth();
  let d = unit === 'day' ? first.getUTCDate() : 1;
  for (let guard = 0; guard < 5000; guard++) {
    const t = Date.UTC(y, m, d);
    if (t > t1) break;
    if (t >= t0) starts.push({ t, label: tickLabel(unit, y, m, d, starts.length === 0) });
    if (unit === 'day') d++;
    else if (unit === 'month') m++;
    else y++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  const stride = Math.max(1, Math.ceil(starts.length / Math.max(1, max)));
  const kept = starts.filter((_, i) => i % stride === 0);
  // Position of a time: the fraction of the first commit at or after it (exact on the time axis, even steps on the commit axis).
  return kept.map((s) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < s.t) lo = mid + 1;
      else hi = mid;
    }
    const prevT = lo > 0 ? times[lo - 1] : times[lo];
    const frac = lo > 0 && times[lo] > prevT ? positions[lo - 1] + ((s.t - prevT) / (times[lo] - prevT)) * (positions[lo] - positions[lo - 1]) : positions[lo];
    return { frac, label: s.label };
  });
}

/** Human date for the commit line: `24 Mar 2026`. */
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
