/**
 * Floating notes over the map while the timeline is open: the compare summary card ("+34 files, −5, +120
 * links", from commit A to the playhead) and the hint shown when the map displays the inside of a file.
 */
import React, { useMemo } from 'react';
import type { Frame } from './decorate';
import { indexTopology, linkDiff } from './topo';
import { useTimeline, useTimelineStoreApi } from './TimelineProvider';
import { formatDate } from './scrub-math';

const n = (v: number): string => v.toLocaleString('en-US');
/** A signed count; zero is muted. */
function Num({ v, sign, tone }: { v: number; sign: string; tone: 'add' | 'del' | 'chg' }) {
  return <b className={v === 0 ? 'fl-tl-zero' : `fl-tl-${tone}`}>{sign}{n(v)}</b>;
}

function CompareCard({ frame }: { frame: Frame }) {
  const store = useTimelineStoreApi();
  const history = useTimeline((s) => s.history);
  const topology = useTimeline((s) => s.topology);
  const cmp = frame.compare;
  const links = useMemo(() => {
    if (!cmp || !history || !topology) return null;
    return linkDiff(topology, indexTopology(history, topology), cmp.from, cmp.to);
  }, [cmp, history, topology]);
  if (!cmp || !history) return null;
  const a = history.commits[cmp.from];
  const b = history.commits[cmp.to];
  const same = cmp.from === cmp.to;
  return (
    <div className="fl-tl-compare" role="status" data-testid="tl-compare-card">
      <span>
        <b>A</b> {a.sha.slice(0, 7)} · {formatDate(a.date)} → <b>B</b> {b.sha.slice(0, 7)} · {formatDate(b.date)}
      </span>
      {same ? (
        <span>Move the playhead (B) away from A to see what changed.</span>
      ) : (
        <>
          <span data-testid="tl-compare-files">
            <Num v={cmp.added.size} sign="+" tone="add" /> files · <Num v={cmp.removed.size} sign="−" tone="del" /> · <Num v={cmp.changed.size} sign="~" tone="chg" /> changed
          </span>
          {links ? (
            <span data-testid="tl-compare-links" title={links.from === links.to ? 'Both commits fall between the same two samples, so no link change is known.' : 'From the nearest sampled commits'}>
              <Num v={links.added} sign="+" tone="add" /> links · <Num v={links.removed} sign="−" tone="del" />
            </span>
          ) : (
            <span className="fl-tl-meta">{topology ? 'Link change: A is before the first sample.' : 'Link change needs link history.'}</span>
          )}
        </>
      )}
      <button type="button" className="fl-tl-btn" style={{ height: 24 }} data-testid="tl-compare-clear" onClick={() => store.getState().setCompareFrom(null)}>
        Clear
      </button>
    </div>
  );
}

export function TimelineOverlays({ frame, notApplicable }: { frame: Frame | null; notApplicable: boolean }) {
  if (notApplicable) {
    return (
      <div className="fl-zone-notice" role="status" data-testid="tl-not-applicable">
        The map shows the inside of a file. Go up a level to watch the repository grow.
      </div>
    );
  }
  return frame?.compare ? <CompareCard frame={frame} /> : null;
}
