/**
 * "Add link history (slow)": builds the sampled dependency topology on the daemon (a cold parse of the
 * code at up to 25 commits, about ten seconds each), shows its progress, and can cancel it. The Map keeps
 * working meanwhile. Without it the timeline animates files, zones and size only.
 */
import React from 'react';
import { TOPOLOGY_DEFAULT_SAMPLES } from '../../contracts/history.js';
import { ApiError } from '../api/http';
import { cancelTopologyBuild, fetchTopologyStatus, startTopologyBuild } from './api';
import { useTimeline, useTimelineBase, useTimelineStoreApi } from './TimelineProvider';
import { formatDate } from './scrub-math';

const SECONDS_PER_SAMPLE = 10;

export const estimateMinutes = (commits: number): number => Math.max(1, Math.round((Math.min(TOPOLOGY_DEFAULT_SAMPLES, commits) * SECONDS_PER_SAMPLE) / 60));

export function TopologyPanel({ onClose }: { onClose: () => void }) {
  const store = useTimelineStoreApi();
  const base = useTimelineBase();
  const commits = useTimeline((s) => s.history?.commits.length ?? 0);
  const topology = useTimeline((s) => s.topology);
  const job = useTimeline((s) => s.topoJob);
  const error = useTimeline((s) => s.topoError);
  const running = job?.state === 'running';
  const p = job?.progress;

  const start = async () => {
    const s = store.getState();
    s.setTopoError(null);
    try {
      s.setTopoJob((await startTopologyBuild(base)).status);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'job_running') s.setTopoJob(await fetchTopologyStatus(base).catch(() => null));
      else s.setTopoError(err instanceof Error ? err.message : 'Could not start the build');
    }
  };
  const cancel = async () => {
    try {
      store.getState().setTopoJob(await cancelTopologyBuild(base));
    } catch (err) {
      store.getState().setTopoError(err instanceof Error ? err.message : 'Could not cancel');
    }
  };

  return (
    <div className="fl-tl-pop" role="dialog" aria-label="Link history" data-testid="tl-topology-panel">
      <h4>Link history</h4>
      {topology ? (
        <p>
          Showing how files linked to each other at {topology.samples.length} sampled commits (about every {topology.every} commit{topology.every === 1 ? '' : 's'}; built {formatDate(topology.built_at)}).
          {topology.capped ? ' Capped to keep the file small.' : ''}
        </p>
      ) : (
        <p>
          Without it, the timeline animates files, zones and size, and hides links. Link history parses your code at up to {Math.min(TOPOLOGY_DEFAULT_SAMPLES, commits)} sampled commits, roughly {SECONDS_PER_SAMPLE} s each: about {estimateMinutes(commits)} minute{estimateMinutes(commits) === 1 ? '' : 's'}
          here. It runs in the background and your working copy is never touched.
        </p>
      )}
      {running && (
        <>
          <div className="fl-tl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={p?.total ?? 0} aria-valuenow={p?.done ?? 0} data-testid="tl-topology-progress">
            <i style={{ width: `${p && p.total ? (p.done / p.total) * 100 : 5}%` }} />
          </div>
          <span className="fl-tl-note">
            {p ? `${p.done} of ${p.total} samples${p.reused ? ` (${p.reused} reused)` : ''}${p.current ? ` · parsing ${p.current.slice(0, 7)}` : ''}` : 'Starting…'}
          </span>
        </>
      )}
      {job?.state === 'cancelled' && <span className="fl-tl-note">Cancelled. Nothing was saved.</span>}
      {error && <span className="fl-tl-note" role="alert" style={{ color: 'var(--fl-danger)' }}>{error}</span>}
      <div className="fl-tl-group" style={{ justifyContent: 'flex-end' }}>
        {running ? (
          <button type="button" className="fl-tl-btn" data-testid="tl-topology-cancel" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="fl-tl-btn is-primary" style={{ padding: '0 12px' }} data-testid="tl-topology-start" onClick={start}>
            {topology ? 'Rebuild' : 'Build link history'}
          </button>
        )}
        <button type="button" className="fl-tl-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
