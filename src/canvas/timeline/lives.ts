/**
 * The life of every file card across the commits of a `HistorySummary`, in
 * TODAY's names: the timeline keeps every card at one fixed place and only
 * toggles how it looks, so a file that was renamed later is one card whose
 * life began under its old name.
 *
 * Built once per history by replaying it (the shared engine of
 * `src/analysis/history/replay.ts`). A *lineage* is one file followed through
 * renames; it maps to the card of its FINAL path (the path it had when it
 * ended, or has now). A path that was deleted and added again has several
 * lineages, hence several intervals.
 *
 * Pure: no DOM, no React.
 */
import type { HistorySummary } from '../../contracts/history.js';
import { applyCommit, newReplayState, recencyHeat } from '../../analysis/history/index.js';

/** One card's life. Interval `k` is `[born[k], died[k])`; `died` is `Infinity` while the file is alive. */
export interface FileLife {
  path: string;
  born: number[];
  died: number[];
  /** Commit indices (ascending) where the file was modified or renamed. */
  changes: number[];
}

export type Phase = 'live' | 'ghost' | 'absent';

export interface FileState {
  phase: Phase;
  /** Recency heat 0..1 (live files only). */
  heat: number;
  /** Born in `(prev, index]` (only set for a forward step). */
  entered: boolean;
  /** Modified in `(prev, index]` while alive and not new. */
  pulsed: boolean;
  /** Index of the commit that deleted it (ghosts). */
  deletedAt: number;
}

/** A deleted file stays on the map, dashed and faded, for this many commits after its deletion (never at the newest commit). */
export const GHOST_WINDOW = 3;
/** Entering / pulsing is only flagged for forward steps up to this long; bigger jumps just show the state. */
export const ANIMATE_MAX_STEP = 48;
/** Heat fades to 0 over this many commits (a fraction of the history, so small repositories do not glow all over). */
export const heatWindow = (commits: number): number => Math.max(4, Math.min(40, Math.round(commits * 0.15)));

/** What a state depends on besides the playhead. */
export interface StateOptions {
  /** Index of the newest commit: nothing is a ghost there, so the newest state is exactly today's map. */
  last: number;
  heatWindow: number;
}
const DEFAULTS: StateOptions = { last: Infinity, heatWindow: 30 };

export type Lives = Map<string, FileLife>;

export function buildLives(history: Pick<HistorySummary, 'commits' | 'baseline' | 'truncated'>): Lives {
  const state = newReplayState(history.baseline ?? [], true);
  interface Raw { born: number; died: number; changes: number[] }
  const raw = new Map<number, Raw>();
  for (const f of state.live.values()) raw.set(f.lineage, { born: -1, died: Infinity, changes: [] });
  history.commits.forEach((c, i) =>
    applyCommit(state, c, i, history.truncated, (d) => {
      let r = raw.get(d.lineage);
      if (!r) raw.set(d.lineage, (r = { born: i, died: Infinity, changes: [] }));
      if (d.files === 1) r.born = i;
      else if (d.files === -1) r.died = i;
      else r.changes.push(i);
    }),
  );
  const lives: Lives = new Map();
  for (const [lineage, r] of raw) {
    const paths = state.paths?.get(lineage);
    const path = paths?.[paths.length - 1];
    if (!path) continue;
    let life = lives.get(path);
    if (!life) lives.set(path, (life = { path, born: [], died: [], changes: [] }));
    life.born.push(r.born);
    life.died.push(r.died);
    life.changes.push(...r.changes);
  }
  for (const life of lives.values()) {
    // Intervals ascending by birth (re-adds come later), changes ascending.
    const order = life.born.map((_, i) => i).sort((a, b) => life.born[a] - life.born[b]);
    life.born = order.map((i) => life.born[i]);
    life.died = order.map((i) => life.died[i]);
    life.changes.sort((a, b) => a - b);
  }
  return lives;
}

const ABSENT: FileState = { phase: 'absent', heat: 0, entered: false, pulsed: false, deletedAt: -1 };

/** Number of entries of `sorted` that are `<= x` (binary search). */
function countAtMost(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How one card looks after commit `index`, coming from commit `prev` (`prev === index`: no animation). */
export function fileStateAt(life: FileLife, index: number, prev: number, opts: StateOptions = DEFAULTS): FileState {
  const k = countAtMost(life.born, index) - 1; // newest interval that has begun
  if (k < 0) return ABSENT;
  const born = life.born[k];
  const died = life.died[k];
  if (index >= died) {
    return index - died < GHOST_WINDOW && index < opts.last ? { phase: 'ghost', heat: 0, entered: false, pulsed: false, deletedAt: died } : ABSENT;
  }
  const forward = index > prev && index - prev <= ANIMATE_MAX_STEP;
  const entered = forward && born > prev;
  const upTo = countAtMost(life.changes, index);
  const lastChange = upTo > 0 ? life.changes[upTo - 1] : -1;
  const lastChanged = lastChange >= born ? lastChange : born; // changes before `born` belong to an earlier life
  const pulsed = forward && !entered && lastChanged > prev;
  return { phase: 'live', heat: recencyHeat({ last_changed: lastChanged }, index, opts.heatWindow), entered, pulsed, deletedAt: -1 };
}

/** Per-card state of every card with a life. */
export function statesAt(lives: Lives, index: number, prev: number, opts: StateOptions = DEFAULTS): Map<string, FileState> {
  const out = new Map<string, FileState>();
  for (const [path, life] of lives) out.set(path, fileStateAt(life, index, prev, opts));
  return out;
}

/** Cards that are alive after commit `index` (what `snapshotAt(...).files` holds, in today's names). */
export function liveAt(lives: Lives, index: number): Set<string> {
  const out = new Set<string>();
  for (const [path, life] of lives) {
    const k = countAtMost(life.born, index) - 1;
    if (k >= 0 && index < life.died[k]) out.add(path);
  }
  return out;
}

/** Cards with a lineage that is dead at the newest commit — candidates for ghost cards when today's graph lacks them. */
export function endedPaths(lives: Lives): string[] {
  const out: string[] = [];
  for (const [path, life] of lives) if (life.died[life.died.length - 1] !== Infinity) out.push(path);
  return out;
}
