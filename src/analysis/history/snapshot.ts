/**
 * The repo as it stood after commit `index`: which files were live, when
 * each first appeared and was last changed (recency heat), and which were
 * deleted (ghosts). Pure (no `node:*`), safe for the browser bundle.
 */
import type { HistorySummary } from '../../contracts/history.js';
import { applyCommit, newReplayState, type LiveFile } from './replay.js';

export { BEFORE_WINDOW } from './replay.js';
export type SnapshotFile = Omit<LiveFile, 'lineage'>;

export interface HistorySnapshot {
  /** The commit index this is the state after; `-1` = before the first commit (the baseline only). */
  index: number;
  sha: string | null;
  date: string | null;
  /** Live files. `first_seen` / `last_changed` are commit indices (`-1` = before the window). */
  files: Map<string, SnapshotFile>;
  /** Deleted and not re-added: path → index of the deleting commit. */
  ghosts: Map<string, number>;
}

/** `index` is clamped to `[-1, commits.length - 1]`. O(changes up to `index`). */
export function snapshotAt(history: Pick<HistorySummary, 'commits' | 'baseline' | 'truncated'>, index: number): HistorySnapshot {
  const last = Math.max(-1, Math.min(Math.trunc(index), history.commits.length - 1));
  const state = newReplayState(history.baseline ?? []);
  for (let i = 0; i <= last; i++) applyCommit(state, history.commits[i], i, history.truncated);
  const files = new Map<string, SnapshotFile>();
  for (const [path, f] of state.live) {
    files.set(path, { first_seen: f.first_seen, last_changed: f.last_changed, loc: f.loc, commits: f.commits });
  }
  const c = last >= 0 ? history.commits[last] : null;
  return { index: last, sha: c?.sha ?? null, date: c?.date ?? null, files, ghosts: state.ghosts };
}

/** Recency heat in `[0, 1]`: 1 = changed in the newest commit shown, fading to 0 over `window` commits. */
export function recencyHeat(file: Pick<SnapshotFile, 'last_changed'>, index: number, window = 50): number {
  if (file.last_changed < 0) return 0;
  return Math.max(0, 1 - (index - file.last_changed) / Math.max(1, window));
}

/** Index of a commit in the history, or -1. */
export function commitIndex(history: Pick<HistorySummary, 'commits'>, sha: string): number {
  return history.commits.findIndex((c) => c.sha === sha || (sha.length >= 7 && c.sha.startsWith(sha)));
}
