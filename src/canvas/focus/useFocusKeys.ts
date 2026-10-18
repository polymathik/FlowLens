/**
 * Keyboard of Focus mode: `F` focuses the selected node (or leaves Focus mode when nothing is selected),
 * `Esc` leaves it. Ignored while typing, with modifier keys, and while something else owns Escape
 * (the search box, a context menu, the rules editor).
 */
import { useEffect } from 'react';
import { useCanvasStoreApi } from '../store/canvas-store';
import type { FocusActions } from './focus-actions';

const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useFocusKeys(actions: FocusActions, blocked: boolean): void {
  const store = useCanvasStoreApi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const s = store.getState();
      if (e.key === 'Escape' && s.focus && !blocked && !s.searchOpen) {
        actions.exit();
        e.preventDefault();
      } else if ((e.key === 'f' || e.key === 'F') && !blocked && !s.searchOpen) {
        if (s.selectedNodeId && actions.canFocus(s.selectedNodeId)) actions.enter(s.selectedNodeId);
        else if (s.focus) actions.exit();
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, blocked, store]);
}
