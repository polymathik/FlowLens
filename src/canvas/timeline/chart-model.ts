/**
 * Data of the per-zone stacked area chart under the scrubber: one series per
 * top-level zone of the map (coloured like the zone), files or lines over the
 * commits, plus the SVG paths of the stack. Pure.
 */
import { growthByZone, type GrowthSeries } from '../../analysis/history/index.js';
import type { HistorySummary } from '../../contracts/history.js';
import type { ItemMap } from './items.js';
import { sampleIndices } from './scrub-math.js';

export type Metric = 'files' | 'loc';

export interface ChartSeries {
  /** Top-level item id; null for the files no zone claims (lockfiles, files outside the cards). */
  key: string | null;
  label: string;
  /** Zone hue 0..5. */
  hue: number;
  values: number[];
}

export const OTHER_LABEL = 'Other files';
export const MORE_LABEL = 'Smaller zones';
/** Key of the merged series (a real zone id never looks like this). */
export const MORE_KEY = '__more__';
/** Series drawn before the smallest are merged into one. */
export const MAX_SERIES = 8;

/** Past this share of the newest total, the files no zone claims are not stacked (see `outsideOf`). */
export const OUTSIDE_SHARE = 0.5;

/**
 * Files outside the zones of the current view (the rest of the repository while the map is drilled into a
 * folder), per commit, when they are most of the repository: then the chart shows the view's own growth instead
 * of one grey slab, and the legend says how many files are left out. Null when they are a few lockfiles.
 */
export function outsideOf(growth: GrowthSeries, metric: Metric): number[] | null {
  const other = growth.zones.find((z) => z.zone === null);
  const values = other ? (metric === 'files' ? other.files : other.loc) : null;
  const total = metric === 'files' ? growth.total.files : growth.total.loc;
  const at = (v: number[]): number => v[v.length - 1] ?? 0;
  return values && at(total) > 0 && at(values) / at(total) > OUTSIDE_SHARE ? values : null;
}

/** Growth of every top-level item of the cut. */
export function growthOf(history: Pick<HistorySummary, 'commits' | 'baseline' | 'truncated'>, items: ItemMap | null): GrowthSeries {
  return growthByZone(history, (path) => items?.topOf.get(path) ?? null);
}

const sum = (a: number[], b: number[]): number[] => a.map((v, i) => v + b[i]);

/** Series for the chart, biggest first (they stack from the bottom up); the tail is merged into one. */
export function chartSeries(growth: GrowthSeries, items: ItemMap | null, metric: Metric, max = MAX_SERIES): ChartSeries[] {
  const rows: ChartSeries[] = growth.zones.map((z) => {
    const item = z.zone === null ? undefined : items?.byId.get(z.zone);
    return { key: z.zone, label: item?.label ?? OTHER_LABEL, hue: item?.colorIndex ?? 5, values: metric === 'files' ? z.files : z.loc };
  });
  const last = (s: ChartSeries): number => s.values[s.values.length - 1] ?? 0;
  const other = rows.find((r) => r.key === null);
  const hasOther = !!other && other.values.some((v) => v > 0) && outsideOf(growth, metric) === null;
  const zones = rows.filter((r) => r.key !== null).sort((a, b) => last(b) - last(a) || a.label.localeCompare(b.label));
  // Slots: the biggest zones, one for the merged smaller ones, one for files no zone claims (kept apart: while
  // drilled into a folder that is most of the repository and must not read as "smaller zones").
  const slots = Math.max(2, max - (hasOther ? 1 : 0));
  const head = zones.slice(0, zones.length > slots ? slots - 1 : slots);
  const tail = zones.slice(head.length);
  const out = [...head];
  if (tail.length > 0) out.push({ key: MORE_KEY, label: MORE_LABEL, hue: 5, values: tail.map((t) => t.values).reduce(sum) });
  if (other && hasOther) out.push({ ...other, label: OTHER_LABEL, hue: 5 });
  return out;
}

export interface StackPath {
  key: string | null;
  label: string;
  hue: number;
  d: string;
}

/**
 * Area paths of the stack in a `width` × `height` box (y grows downwards), at most `maxPoints` points
 * per outline. Returns the paths (bottom series first) and the y-axis maximum.
 */
export function stackPaths(series: ChartSeries[], positions: readonly number[], width: number, height: number, maxPoints: number): { paths: StackPath[]; yMax: number } {
  const n = positions.length;
  if (n === 0 || series.length === 0) return { paths: [], yMax: 0 };
  const idx = sampleIndices(positions, Math.max(2, maxPoints));
  const totals = new Array<number>(n).fill(0);
  for (const s of series) for (let i = 0; i < n; i++) totals[i] += s.values[i] ?? 0;
  const yMax = Math.max(1, ...totals);
  const x = (i: number): number => positions[i] * width;
  const y = (v: number): number => height - (v / yMax) * height;
  const base = new Array<number>(n).fill(0);
  const paths: StackPath[] = [];
  for (const s of series) {
    const upper = idx.map((i) => `${x(i).toFixed(1)},${y(base[i] + (s.values[i] ?? 0)).toFixed(1)}`);
    const lower = [...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(base[i]).toFixed(1)}`);
    paths.push({ key: s.key, label: s.label, hue: s.hue, d: `M${upper.join('L')}L${lower.join('L')}Z` });
    for (let i = 0; i < n; i++) base[i] += s.values[i] ?? 0;
  }
  return { paths, yMax };
}
