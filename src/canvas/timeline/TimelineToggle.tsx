/** Toolbar button that opens and closes the timeline. */
import React from 'react';
import { button, buttonActive } from '../components/shared/ui';
import { useTimeline, useTimelineStoreApi } from './TimelineProvider';

export function TimelineToggle() {
  const store = useTimelineStoreApi();
  const open = useTimeline((s) => s.open);
  return (
    <button
      type="button"
      data-testid="timeline-button"
      style={open ? buttonActive : button}
      aria-pressed={open}
      title="Watch the repository grow, commit by commit"
      onClick={() => store.getState().setOpen(!open)}
    >
      Timeline
    </button>
  );
}
