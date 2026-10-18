/**
 * The timeline at the bottom of the Map: transport (first / step / play / step / newest, speed), the commit
 * under the playhead, the scrubber with its sparkline and per-zone growth chart, compare and link-history
 * controls. Loading, empty and error states keep the bar small; the Map never waits for it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { HistorySummary } from '../../contracts/history.js';
import { SPEEDS } from './playback';
import { ANIMATE_MAX_STEP } from './lives';
import { growthOf, chartSeries, outsideOf } from './chart-model';
import type { Frame } from './decorate';
import type { ItemMap } from './items';
import type { GhostInfo } from './useTimelineMap';
import { useTimeline, useTimelineStoreApi } from './TimelineProvider';
import { useTimelineKeys } from './useTimelineKeys';
import { Stage } from './Stage';
import { TopologyPanel } from './TopologyPanel';
import { formatDate } from './scrub-math';
import { CloseIcon, FirstIcon, LastIcon, PauseIcon, PlayIcon, StepBackIcon, StepForwardIcon } from './icons';
import { useReactFlow } from '@xyflow/react';
import { FIT_VIEW_MAX_ZOOM } from '../../contracts/canvas/index.js';
import { FIT_PADDING } from '../hooks/useCanvasLayout';
import './timeline.css';

interface BarProps {
  items: ItemMap | null;
  ghosts: GhostInfo;
  frame: Frame | null;
}

const compact = (n: number): string => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString('en-US'));
const plural = (n: number, w: string): string => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

function Shell({ children, onClose, testId }: { children: React.ReactNode; onClose: () => void; testId: string }) {
  return (
    <section className="fl-tl-bar" role="region" aria-label="History timeline" data-testid={testId}>
      <div className="fl-tl-empty">
        {children}
        <span className="fl-tl-spacer" />
        <button type="button" className="fl-tl-btn" aria-label="Close timeline" data-testid="tl-close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
    </section>
  );
}

/** The bar changes the height of the map: fit the view again once the layout (ghost cards) has settled. */
function useRefit(deps: unknown[]): void {
  const rf = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: FIT_PADDING, maxZoom: FIT_VIEW_MAX_ZOOM, duration: 200 }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function TimelineBar(props: BarProps) {
  const store = useTimelineStoreApi();
  const open = useTimeline((s) => s.open);
  const load = useTimeline((s) => s.load);
  const chartOpen = useTimeline((s) => s.chartOpen);
  useRefit([open, load.status, chartOpen, props.ghosts.added]);
  const close = () => store.getState().setOpen(false);
  useTimelineKeys(open && load.status === 'ready');
  if (!open) return null;
  if (load.status === 'loading' || load.status === 'idle') {
    return (
      <Shell onClose={close} testId="tl-loading">
        <span>Building history…</span>
        <div className="fl-tl-progress is-indeterminate" style={{ width: 160 }} role="progressbar" aria-label="Building history">
          <i />
        </div>
        <span className="fl-tl-note">The map stays usable meanwhile.</span>
      </Shell>
    );
  }
  if (load.status === 'empty') {
    return (
      <Shell onClose={close} testId="tl-empty">
        <span data-testid="tl-empty-message">{load.reason === 'not_a_git_repo' ? 'This project is not a git repository, so there is no history to replay.' : load.message}</span>
      </Shell>
    );
  }
  if (load.status === 'error') {
    return (
      <Shell onClose={close} testId="tl-error">
        <span role="alert">Could not load the history: {load.message}</span>
        <button type="button" className="fl-tl-btn" onClick={() => { store.getState().setOpen(false); store.getState().setOpen(true); }}>
          Try again
        </button>
      </Shell>
    );
  }
  return <ReadyBar {...props} onClose={close} />;
}

function ReadyBar({ items, ghosts, frame, onClose }: BarProps & { onClose: () => void }) {
  const store = useTimelineStoreApi();
  const history = useTimeline((s) => s.history) as HistorySummary;
  const { index, prev, playing, speed, axis, chart, chartOpen, compareFrom, mainline } = useTimeline((s) => s);
  const topology = useTimeline((s) => s.topology);
  const job = useTimeline((s) => s.topoJob);
  const [linksOpen, setLinksOpen] = useState(false);
  const n = history.commits.length;
  const c = history.commits[index];
  const growth = useMemo(() => growthOf(history, items), [history, items]);
  const series = useMemo(() => chartSeries(growth, items, chart), [growth, items, chart]);
  const outside = useMemo(() => outsideOf(growth, chart), [growth, chart]);
  const files = growth.total.files[index] ?? 0;
  const gained = Math.abs(index - prev) <= ANIMATE_MAX_STEP ? files - (growth.total.files[prev] ?? files) : 0;
  const cards = frame ? [...(items?.tops ?? [])].reduce((s, t) => s + (frame.counts.get(t.id)?.count ?? 0), 0) : null;
  const branchy = history.commits.some((x) => x.parents.length > 1);
  const when = `${formatDate(c.date)}`;
  const valueText = `Commit ${index + 1} of ${n}: ${c.subject}, ${when}, ${plural(files, 'file')}`;
  const running = job?.state === 'running';
  const set = store.getState;

  return (
    <section className="fl-tl-bar" role="region" aria-label="History timeline" data-testid="tl-bar" data-index={index} data-playing={playing} data-cards={cards ?? ''} data-files={files}>
      <div className="fl-tl-controls">
        <div className="fl-tl-group" role="group" aria-label="Playback">
          <button type="button" className="fl-tl-btn" data-testid="tl-first" aria-label="First commit" title="First commit (Home)" disabled={index === 0} onClick={() => { set().pause(); set().seek(0); }}><FirstIcon /></button>
          <button type="button" className="fl-tl-btn" data-testid="tl-prev" aria-label="Previous commit" title="Previous commit (←)" disabled={index === 0} onClick={() => { set().pause(); set().step(-1); }}><StepBackIcon /></button>
          <button type="button" className="fl-tl-btn is-primary" data-testid="tl-play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => (playing ? set().pause() : set().play())}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="fl-tl-btn" data-testid="tl-next" aria-label="Next commit" title="Next commit (→)" disabled={index >= n - 1} onClick={() => { set().pause(); set().step(1); }}><StepForwardIcon /></button>
          <button type="button" className="fl-tl-btn" data-testid="tl-last" aria-label="Newest commit" title="Newest commit (End)" disabled={index >= n - 1} onClick={() => { set().pause(); set().seek(n - 1); }}><LastIcon /></button>
        </div>
        <div className="fl-tl-group fl-tl-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((sp) => (
            <button key={sp} type="button" className="fl-tl-btn" data-testid={`tl-speed-${sp}`} aria-pressed={speed === sp} onClick={() => set().setSpeed(sp)}>{sp}×</button>
          ))}
        </div>
        <div className="fl-tl-commit" data-testid="tl-commit">
          <span className="fl-tl-sha" data-testid="tl-sha">{c.sha.slice(0, 7)}</span>
          <span className="fl-tl-subject" title={c.subject}>{c.subject}</span>
          <span className="fl-tl-meta">{when} · {c.author}</span>
        </div>
        <span className="fl-tl-total" data-testid="tl-total" title="Files in the project at this commit (the files the Map shows)">
          <b>{files.toLocaleString('en-US')}</b> files{gained !== 0 && <span className={gained > 0 ? 'fl-tl-add' : 'fl-tl-del'}> {gained > 0 ? '+' : '−'}{Math.abs(gained)}</span>}
          {!history.truncated && growth.total.loc[index] > 0 && <> · {compact(growth.total.loc[index])} lines</>}
          <span className="fl-tl-meta"> · {index + 1}/{n}</span>
        </span>
      </div>
      <div className="fl-tl-controls">
        <button type="button" className="fl-tl-btn" data-testid="tl-compare" aria-pressed={compareFrom !== null} title="Pin this commit as A, then move the playhead to B (Shift-click on the scrubber also pins A)" onClick={() => set().setCompareFrom(compareFrom === null ? index : null)}>
          {compareFrom === null ? 'Compare…' : 'Clear compare'}
        </button>
        <div className="fl-tl-group" role="group" aria-label="Axis">
          <button type="button" className="fl-tl-btn" data-testid="tl-axis" aria-pressed={axis === 'commit'} title={axis === 'time' ? 'Spread commits evenly instead of by date' : 'Place commits by date'} onClick={() => set().setAxis(axis === 'time' ? 'commit' : 'time')}>
            {axis === 'time' ? 'By date' : 'By commit'}
          </button>
        </div>
        <div className="fl-tl-group" role="group" aria-label="Growth chart">
          <button type="button" className="fl-tl-btn" data-testid="tl-chart-toggle" aria-pressed={chartOpen} onClick={() => set().setChartOpen(!chartOpen)}>Growth chart</button>
          {chartOpen && (['files', 'loc'] as const).map((m) => (
            <button key={m} type="button" className="fl-tl-btn" data-testid={`tl-metric-${m}`} aria-pressed={chart === m} onClick={() => set().setChart(m)}>{m === 'files' ? 'Files' : 'Lines'}</button>
          ))}
        </div>
        {branchy && (
          <div className="fl-tl-group" role="group" aria-label="Which commits">
            <button type="button" className="fl-tl-btn" data-testid="tl-mode-mainline" aria-pressed={mainline} title="Merges on the main line: every step is a real tree of the repository" onClick={() => set().setMainline(true)}>Mainline</button>
            <button type="button" className="fl-tl-btn" data-testid="tl-mode-all" aria-pressed={!mainline} title="Every commit, oldest first: finer steps, but file sets are approximate where branches were merged" onClick={() => set().setMainline(false)}>All commits</button>
          </div>
        )}
        <span className="fl-tl-spacer" />
        <button type="button" className="fl-tl-btn" data-testid="tl-links" aria-pressed={linksOpen} aria-haspopup="dialog" onClick={() => setLinksOpen((v) => !v)}>
          {running && job?.progress ? `Building links ${job.progress.done}/${job.progress.total}…` : topology ? `Link history · ${topology.samples.length} samples` : 'Add link history (slow)'}
        </button>
        <button type="button" className="fl-tl-btn" aria-label="Close timeline" data-testid="tl-close" title="Close the timeline" onClick={onClose}><CloseIcon /></button>
      </div>
      {linksOpen && <TopologyPanel onClose={() => setLinksOpen(false)} />}
      <Stage
        history={history} axis={axis} index={index} compareFrom={compareFrom} series={series} chartOpen={chartOpen} metric={chart} valueText={valueText}
        onSeek={(i) => set().seek(i)} onScrubStart={() => set().pause()} onPin={(i) => set().setCompareFrom(i)}
      />
      <div className="fl-tl-legend" data-testid="tl-legend" aria-label={`Growth per zone at the playhead (${chart === 'files' ? 'files' : 'lines'})`}>
        {chartOpen && series.map((s) => (
          <span key={s.key ?? 'other'}>
            <i style={{ background: s.key === null ? 'var(--fl-faint)' : `rgb(var(--fl-zone-${s.hue}))` }} />
            {s.label} <b>{(s.values[index] ?? 0).toLocaleString('en-US')}</b>
          </span>
        ))}
        {chartOpen && outside && (
          <span data-testid="tl-outside" title="Files outside the folder the map shows: not drawn in the chart">
            <i style={{ background: 'var(--fl-faint)' }} />
            Outside this view <b>{(outside[index] ?? 0).toLocaleString('en-US')}</b>
          </span>
        )}
        <Notes history={history} mainline={mainline} branchy={branchy} ghosts={ghosts} hasLinks={topology !== null} />
      </div>
      <span className="fl-tl-sr" aria-live="polite" role="status">{playing ? '' : valueText}</span>
    </section>
  );
}

function Notes({ history, mainline, branchy, ghosts, hasLinks }: { history: HistorySummary; mainline: boolean; branchy: boolean; ghosts: GhostInfo; hasLinks: boolean }) {
  const notes: string[] = [];
  if (!hasLinks) notes.push('Links are hidden: they need link history.');
  if (branchy && !mainline) notes.push('All commits: where branches were merged, the file set at a commit is approximate.');
  if (history.truncated) notes.push(`Only the newest ${history.commits.length.toLocaleString('en-US')} commits are loaded; earlier files count from the first of them.`);
  if (ghosts.dropped > 0) notes.push(`${plural(ghosts.dropped, 'older deleted file')} not drawn (counted in the chart).`);
  if (notes.length === 0) return null;
  return <span className="fl-tl-note" data-testid="tl-notes" style={{ marginLeft: 'auto' }}>{notes.join(' ')}</span>;
}
