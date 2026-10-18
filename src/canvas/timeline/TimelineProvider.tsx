/**
 * Owns the timeline of one Map tab: the store, the history / link-history
 * loaders and the playback clock. Mounted once around the canvas; nothing is
 * fetched until the bar is opened, and the Map never waits for it.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useGraphClient, useProjectContext } from '../components/explorer/project-context';
import { buildLives, type Lives } from './lives';
import { fetchHistory, fetchTopology, fetchTopologyStatus } from './api';
import { tick, MAX_FPS } from './playback';
import { createTimelineStore, type TimelineState, type TimelineStore } from './timeline-store';

interface TimelineContextValue {
  store: TimelineStore;
  /** Base URL of the project's canvas API. */
  base: string;
  /** The loaded history replayed once (null until it is there). */
  lives: Lives | null;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

function useCtx(): TimelineContextValue {
  const v = useContext(TimelineContext);
  if (!v) throw new Error('TimelineProvider is missing');
  return v;
}

export const useTimelineStoreApi = (): TimelineStore => useCtx().store;
export const useTimelineBase = (): string => useCtx().base;
export function useTimeline<T>(selector: (s: TimelineState) => T): T {
  return useStore(useCtx().store, selector);
}

/** `prefers-reduced-motion: reduce`, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** The replayed lives of the loaded history, computed once by the provider. */
export const useLives = (): Lives | null => useCtx().lives;

function useHistoryLoader(store: TimelineStore, base: string, revision: number): void {
  const open = useStore(store, (s) => s.open);
  const mainline = useStore(store, (s) => s.mainline);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const s = store.getState();
    s.setLoading();
    fetchHistory(base, mainline, ctl.signal).then(
      (res) => {
        const st = store.getState();
        if (res.kind === 'empty') return st.setEmpty(res.reason, res.message);
        const h = res.history;
        if (h.commits.length < 2) return st.setEmpty('too_short', `History too short: this project has ${h.commits.length === 1 ? 'one commit' : 'no commits'}, so there is nothing to play back yet.`);
        const cur = st.history;
        if (cur && cur.head === h.head && cur.commits.length === h.commits.length) return;
        st.setHistory(h);
      },
      (err) => !ctl.signal.aborted && store.getState().setError(err instanceof Error ? err.message : 'Could not load the history'),
    );
    return () => ctl.abort();
  }, [open, mainline, base, revision, store]);
}


function useTopologyLoader(store: TimelineStore, base: string): void {
  const open = useStore(store, (s) => s.open);
  const hasHistory = useStore(store, (s) => s.history !== null);
  const running = useStore(store, (s) => s.topoJob?.state === 'running');
  const head = useStore(store, (s) => s.history?.head ?? '');
  // Stored link history (from an earlier build or the CLI), loaded quietly.
  useEffect(() => {
    if (!open || !hasHistory) return;
    const ctl = new AbortController();
    fetchTopology(base, ctl.signal).then((t) => !ctl.signal.aborted && store.getState().setTopology(t), () => undefined);
    return () => ctl.abort();
  }, [open, hasHistory, head, base, store]);
  // A running build is polled once a second; when it ends the result is fetched.
  useEffect(() => {
    if (!open || !running) return;
    const ctl = new AbortController();
    const timer = setInterval(() => {
      fetchTopologyStatus(base, ctl.signal)
        .then(async (job) => {
          if (ctl.signal.aborted) return;
          // The result first: publishing the finished job stops this poller (and aborts `ctl`) before the fetch would end.
          if (job.state === 'done') store.getState().setTopology(await fetchTopology(base));
          store.getState().setTopoJob(job);
          if (job.state === 'failed') store.getState().setTopoError(job.error?.message ?? 'The link history could not be built');
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      clearInterval(timer);
      ctl.abort();
    };
  }, [open, running, base, store]);
}

/** requestAnimationFrame clock: at most `MAX_FPS` redraws a second, one store update per frame. */
function usePlayback(store: TimelineStore): void {
  const playing = useStore(store, (s) => s.playing);
  const carry = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    carry.current = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const elapsed = now - last;
      if (elapsed < 1000 / MAX_FPS) return;
      last = now;
      const s = store.getState();
      const lastIdx = (s.history?.commits.length ?? 1) - 1;
      const r = tick({ index: s.index, carry: carry.current }, elapsed, s.speed, lastIdx);
      carry.current = r.carry;
      if (r.index !== s.index) s.seek(r.index);
      if (r.done) s.pause();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, store]);
}

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const client = useGraphClient();
  const { revision } = useProjectContext();
  const store = useMemo(createTimelineStore, [client]);
  const history = useStore(store, (s) => s.history);
  const lives = useMemo(() => (history ? buildLives(history) : null), [history]);
  const value = useMemo(() => ({ store, base: client.base, lives }), [store, client.base, lives]);
  useHistoryLoader(store, client.base, revision);
  useTopologyLoader(store, client.base);
  usePlayback(store);
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
}
