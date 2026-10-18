/**
 * Growth of every zone over the commits of a `HistorySummary`: live files,
 * lines of code and ghosts (deleted files) per commit — the data of the
 * timeline's stack chart. Pure (no `node:*`), safe for the browser bundle.
 *
 * Zones are *today's*: `zoneOfPath` maps a path that exists now to its zone
 * key. A file's whole life is booked to one zone — the zone of its final
 * path, so a renamed file keeps the zone it ended up in. A deleted file has
 * no path today; its zone is looked up from the last path it had (and the
 * ones before, newest first), which a prefix-based `zoneOfPath` (folders,
 * packages) can answer; otherwise it lands in the `zone: null` series.
 */
import type { HistorySummary } from '../../contracts/history.js';
import { applyCommit, newReplayState, type ReplayDelta } from './replay.js';

/** Maps a project-relative path to a zone key; `null` / `undefined` = no zone. */
export type ZoneOfPath = (path: string) => string | null | undefined;

export interface ZoneGrowth {
  /** Zone key, or `null` for files no zone claims (typically deleted files). */
  zone: string | null;
  /** Live files after each commit. */
  files: number[];
  /** Files deleted so far (cumulative, includes files re-added later). */
  ghosts: number[];
  /** Live lines (baseline files count from 0). */
  loc: number[];
}

export interface GrowthSeries {
  /** Number of commits (the length of every array). */
  length: number;
  /** One entry per zone that ever held a file, in first-appearance order. */
  zones: ZoneGrowth[];
  /** All zones summed (`zone` is `null`). */
  total: ZoneGrowth;
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);
const emptySeries = (zone: string | null, n: number): ZoneGrowth => ({ zone, files: zeros(n), ghosts: zeros(n), loc: zeros(n) });

export function growthByZone(history: Pick<HistorySummary, 'commits' | 'baseline' | 'truncated'>, zoneOfPath: ZoneOfPath): GrowthSeries {
  const n = history.commits.length;
  if (n === 0) return { length: 0, zones: [], total: emptySeries(null, 0) };
  const state = newReplayState(history.baseline ?? [], true);
  const deltas: ReplayDelta[] = [];
  // Baseline files exist before commit 0: book them at index 0 (they are in every sample from the start).
  for (const f of state.live.values()) deltas.push({ lineage: f.lineage, index: 0, files: 1, ghosts: 0, loc: 0 });
  history.commits.forEach((c, i) => applyCommit(state, c, i, history.truncated, (d) => deltas.push(d)));

  const zoneOfLineage = new Map<number, string | null>();
  for (const [lineage, paths] of state.paths ?? []) {
    let zone: string | null = null;
    for (let k = paths.length - 1; k >= 0 && zone === null; k--) zone = zoneOfPath(paths[k]) ?? null;
    zoneOfLineage.set(lineage, zone);
  }

  const byZone = new Map<string | null, ZoneGrowth>();
  const seriesFor = (zone: string | null): ZoneGrowth => {
    let s = byZone.get(zone);
    if (!s) byZone.set(zone, (s = emptySeries(zone, n)));
    return s;
  };
  // Per-commit increments first, prefix sums afterwards.
  for (const d of deltas) {
    const s = seriesFor(zoneOfLineage.get(d.lineage) ?? null);
    s.files[d.index] += d.files;
    s.ghosts[d.index] += d.ghosts;
    s.loc[d.index] += d.loc;
  }
  const total = emptySeries(null, n);
  for (const s of byZone.values()) {
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        s.files[i] += s.files[i - 1];
        s.ghosts[i] += s.ghosts[i - 1];
        s.loc[i] += s.loc[i - 1];
      }
      total.files[i] += s.files[i];
      total.ghosts[i] += s.ghosts[i];
      total.loc[i] += s.loc[i];
    }
  }
  return { length: n, zones: [...byZone.values()], total };
}
