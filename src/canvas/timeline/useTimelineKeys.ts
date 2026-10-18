/**
 * Keyboard of the timeline while it is loaded: Space play / pause, ← → one
 * commit (Shift: ten), Home / End first / newest. Works wherever the focus
 * is on the page except in text fields; Space / Enter are left to a focused
 * button. Registered in the capture phase and stopped, so React Flow does not
 * also nudge a focused card with the arrow keys.
 */
import { useEffect } from 'react';
import { useTimelineStoreApi } from './TimelineProvider';

const TEXT = 'input, textarea, select, [contenteditable="true"]';

export function useTimelineKeys(active: boolean): void {
  const store = useTimelineStoreApi();
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(TEXT)) return;
      const s = store.getState();
      const last = (s.history?.commits.length ?? 1) - 1;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          if (target?.closest?.('button, a, [role="button"]')) return;
          stop();
          return s.playing ? s.pause() : s.play();
        case 'ArrowLeft':
          stop();
          s.pause();
          return s.step(e.shiftKey ? -10 : -1);
        case 'ArrowRight':
          stop();
          s.pause();
          return s.step(e.shiftKey ? 10 : 1);
        case 'Home':
          stop();
          s.pause();
          return s.seek(0);
        case 'End':
          stop();
          s.pause();
          return s.seek(last);
        case 'Escape':
          if (s.compareFrom !== null) {
            stop();
            s.setCompareFrom(null);
          }
          return;
        default:
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, store]);
}
