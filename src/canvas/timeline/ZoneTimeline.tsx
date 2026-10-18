/** What the timeline adds to a zone's chip and card: the change since the last step, and how full the zone is. */
import React from 'react';
import type { ZoneTimelineData } from '../../contracts/canvas/index.js';

export function TimelineDelta({ timeline }: { timeline?: ZoneTimelineData }) {
  if (!timeline || timeline.delta === 0) return null;
  const up = timeline.delta > 0;
  return (
    <span className="fl-tl-delta" data-testid="zone-delta" data-sign={up ? '+' : '-'} title={`${up ? 'Gained' : 'Lost'} ${Math.abs(timeline.delta)} file${Math.abs(timeline.delta) === 1 ? '' : 's'} in this step`}>
      {up ? '+' : '−'}
      {Math.abs(timeline.delta)}
    </span>
  );
}

export function TimelineGrowth({ timeline }: { timeline: ZoneTimelineData }) {
  const pct = timeline.total > 0 ? Math.min(100, (timeline.count / timeline.total) * 100) : 0;
  return (
    <div className="fl-tl-growth" aria-hidden>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
