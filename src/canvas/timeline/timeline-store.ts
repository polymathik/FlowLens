/**
 * Timeline state (one store per Map tab, created by `TimelineProvider`):
 * whether the bar is open, the loaded history, the playhead and playback,
 * the compare marker, and the link-history (topology) job. Plain zustand;
 * everything the playhead moves goes through `seek`, which batches the
 * index and the previous index in a single update.
 */
import { createStore, type StoreApi } from 'zustand';
import type { HistorySummary, HistoryTopology, TopologyJobStatus } from '../../contracts/history.js';
import { playStart, clampIndex, type Speed } from './playback.js';
import { suggestAxis, type AxisMode } from './scrub-math.js';

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  /** Nothing to animate: not a git repository, no commits, or too few of them. */
  | { status: 'empty'; reason: 'not_a_git_repo' | 'no_commits' | 'too_short'; message: string }
  | { status: 'error'; message: string };

export type ChartMetric = 'files' | 'loc';

export interface TimelineState {
  open: boolean;
  load: LoadState;
  history: HistorySummary | null;
  /** Mainline (`first_parent`, exact trees) or every commit (finer on branchy repositories, approximate). */
  mainline: boolean;
  index: number;
  /** The playhead before the last move (drives the entering / pulse animations and the +N chips). */
  prev: number;
  playing: boolean;
  speed: Speed;
  axis: AxisMode;
  chart: ChartMetric;
  chartOpen: boolean;
  /** Commit A of a comparison with the playhead (commit B). */
  compareFrom: number | null;
  topology: HistoryTopology | null;
  topoJob: TopologyJobStatus | null;
  topoError: string | null;

  setOpen: (open: boolean) => void;
  setLoading: () => void;
  setEmpty: (reason: Extract<LoadState, { status: 'empty' }>['reason'], message: string) => void;
  setError: (message: string) => void;
  /** New history: keeps the playhead on the newest commit when it was there (or on first load). */
  setHistory: (history: HistorySummary) => void;
  setMainline: (mainline: boolean) => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: Speed) => void;
  setAxis: (axis: AxisMode) => void;
  setChart: (chart: ChartMetric) => void;
  setChartOpen: (open: boolean) => void;
  setCompareFrom: (index: number | null) => void;
  setTopology: (topology: HistoryTopology | null) => void;
  setTopoJob: (job: TopologyJobStatus | null) => void;
  setTopoError: (message: string | null) => void;
}

export type TimelineStore = StoreApi<TimelineState>;

const lastIndex = (h: HistorySummary | null): number => Math.max(0, (h?.commits.length ?? 1) - 1);

export function createTimelineStore(): TimelineStore {
  return createStore<TimelineState>()((set, get) => ({
    open: false,
    load: { status: 'idle' },
    history: null,
    mainline: true,
    index: 0,
    prev: 0,
    playing: false,
    speed: 1,
    axis: 'time',
    chart: 'files',
    chartOpen: true,
    compareFrom: null,
    topology: null,
    topoJob: null,
    topoError: null,

    setOpen: (open) => set(open ? { open: true } : { open: false, playing: false, compareFrom: null }),
    setLoading: () => set((s) => (s.history ? s : { load: { status: 'loading' } })),
    setEmpty: (reason, message) => set({ load: { status: 'empty', reason, message }, history: null, playing: false }),
    setError: (message) => set((s) => (s.history ? s : { load: { status: 'error', message }, playing: false })),
    setHistory: (history) =>
      set((s) => {
        const last = lastIndex(history);
        const wasAtHead = !s.history || s.index >= lastIndex(s.history);
        const index = wasAtHead ? last : clampIndex(s.index, history.commits.length);
        return {
          history,
          ...(s.history ? {} : { axis: suggestAxis(history.commits) }),
          load: { status: 'ready' },
          index,
          prev: index,
          compareFrom: s.compareFrom === null ? null : clampIndex(s.compareFrom, history.commits.length),
        };
      }),
    setMainline: (mainline) => set((s) => (s.mainline === mainline ? s : { mainline, history: null, playing: false, compareFrom: null, load: { status: 'loading' } })),
    seek: (i) =>
      set((s) => {
        const index = clampIndex(i, s.history?.commits.length ?? 0);
        return index === s.index ? s : { index, prev: s.index };
      }),
    step: (delta) => get().seek(get().index + delta),
    play: () => {
      const s = get();
      if (!s.history || s.history.commits.length < 2) return;
      const from = playStart(s.index, lastIndex(s.history));
      set({ playing: true, ...(from !== s.index ? { index: from, prev: from } : {}) });
    },
    pause: () => set((s) => (s.playing ? { playing: false } : s)),
    setSpeed: (speed) => set({ speed }),
    setAxis: (axis) => set({ axis }),
    setChart: (chart) => set({ chart }),
    setChartOpen: (chartOpen) => set({ chartOpen }),
    setCompareFrom: (compareFrom) => set((s) => ({ compareFrom: compareFrom === null ? null : clampIndex(compareFrom, s.history?.commits.length ?? 0) })),
    setTopology: (topology) => set({ topology }),
    setTopoJob: (topoJob) => set({ topoJob }),
    setTopoError: (topoError) => set({ topoError }),
  }));
}
