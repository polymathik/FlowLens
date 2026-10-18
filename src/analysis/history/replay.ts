/**
 * Replaying commits onto a set of live files — the one place that decides
 * what an add / modify / delete / rename does, shared by `snapshotAt`,
 * `growthByZone` and the cache's baseline fold. Pure (no `node:*`).
 *
 * Identity: a *lineage* is one file followed through renames. A rename moves
 * the lineage to its new path (keeping `first_seen`); a delete ends it (the
 * path becomes a ghost until it is added again, which starts a new lineage).
 *
 * Leniency: history may be a truncated window or a `--no-merges` linearisation
 * of a branchy repo, so a modify/rename of a path we have never seen creates
 * it (`first_seen: -1` when the window is truncated) and a delete of an
 * unknown path is ignored, rather than failing.
 */
import type { HistoryCommit, HistoryFileChange } from '../../contracts/history.js';

/** `first_seen` / `last_changed` of files that already existed when the window starts. */
export const BEFORE_WINDOW = -1;

export interface LiveFile {
  lineage: number;
  /** Commit index the file first appeared at (or `BEFORE_WINDOW`). */
  first_seen: number;
  /** Commit index of the latest change (a rename counts). */
  last_changed: number;
  /** Lines now (added − deleted since first seen, never below 0; unknown for baseline files, counted from 0). */
  loc: number;
  /** Commits that touched the file since the window started. */
  commits: number;
}

export interface ReplayState {
  live: Map<string, LiveFile>;
  /** Deleted and not re-added: path → index of the deleting commit. */
  ghosts: Map<string, number>;
  nextLineage: number;
  /** Every path each lineage has had (oldest first); only filled when `trackPaths` is set. */
  paths?: Map<number, string[]>;
}

/** What one change did to the totals (for series builders). */
export interface ReplayDelta {
  lineage: number;
  index: number;
  files: -1 | 0 | 1;
  ghosts: 0 | 1;
  loc: number;
}

export function newReplayState(baseline: readonly string[] = [], trackPaths = false): ReplayState {
  const state: ReplayState = { live: new Map(), ghosts: new Map(), nextLineage: 0, ...(trackPaths ? { paths: new Map() } : {}) };
  for (const p of baseline) startLineage(state, p, BEFORE_WINDOW, 0);
  return state;
}

function startLineage(state: ReplayState, path: string, index: number, loc: number): LiveFile {
  const f: LiveFile = { lineage: state.nextLineage++, first_seen: index, last_changed: index, loc, commits: index === BEFORE_WINDOW ? 0 : 1 };
  state.live.set(path, f);
  state.ghosts.delete(path);
  state.paths?.set(f.lineage, [path]);
  return f;
}

const grow = (f: LiveFile, change: HistoryFileChange, index: number): number => {
  const next = Math.max(0, f.loc + change.added - change.deleted);
  const delta = next - f.loc;
  f.loc = next;
  f.last_changed = index;
  f.commits++;
  return delta;
};

/** Apply one change at commit `index`. `truncated`: the window starts mid-history. */
export function applyChange(
  state: ReplayState, change: HistoryFileChange, index: number, truncated: boolean, emit?: (d: ReplayDelta) => void,
): void {
  const { live } = state;
  const existing = live.get(change.path);
  const loc0 = Math.max(0, change.added - change.deleted);

  if (change.status === 'D') {
    if (!existing) return;
    live.delete(change.path);
    state.ghosts.set(change.path, index);
    emit?.({ lineage: existing.lineage, index, files: -1, ghosts: 1, loc: -existing.loc });
    return;
  }

  if (change.status === 'R') {
    const from = change.from ?? '';
    const moved = live.get(from);
    if (moved && from !== change.path) {
      live.delete(from);
      state.ghosts.delete(change.path);
      const replaced = live.get(change.path); // overwritten by the rename: that file is gone
      if (replaced) emit?.({ lineage: replaced.lineage, index, files: -1, ghosts: 1, loc: -replaced.loc });
      live.set(change.path, moved);
      state.paths?.get(moved.lineage)?.push(change.path);
      const loc = grow(moved, change, index); // (evaluated before `emit?.` can short-circuit it)
      emit?.({ lineage: moved.lineage, index, files: 0, ghosts: 0, loc });
      return;
    }
    if (!existing) {
      const f = startLineage(state, change.path, truncated ? BEFORE_WINDOW : index, loc0);
      f.last_changed = index;
      f.commits = 1;
      emit?.({ lineage: f.lineage, index, files: 1, ghosts: 0, loc: loc0 });
      return;
    }
  }

  if (existing) {
    const loc = grow(existing, change, index);
    emit?.({ lineage: existing.lineage, index, files: 0, ghosts: 0, loc });
    return;
  }
  const unknownModify = change.status === 'M';
  const f = startLineage(state, change.path, unknownModify && truncated ? BEFORE_WINDOW : index, loc0);
  f.last_changed = index;
  f.commits = 1;
  emit?.({ lineage: f.lineage, index, files: 1, ghosts: 0, loc: loc0 });
}

export function applyCommit(
  state: ReplayState, commit: HistoryCommit, index: number, truncated: boolean, emit?: (d: ReplayDelta) => void,
): void {
  for (const change of commit.files) applyChange(state, change, index, truncated, emit);
}
