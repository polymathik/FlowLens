/**
 * Keyboard of Flow mode: `T` traces the selected item (a function, method or file; a folder opens the
 * picker for it), `Shift+T` asks "who triggers this?", `Esc` closes the picker, then leaves Flow mode.
 * Ignored while typing, with modifier keys, and while something else owns Escape (search, a context menu,
 * the rules editor).
 */
import { useEffect } from 'react';
import { useCanvasStoreApi } from '../store/canvas-store';
import type { FlowActions } from './flow-actions';

/** A control the user types into (a letter key belongs to it). Sliders, checkboxes and selects of the flow bar are not: Esc and T still work after using them. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t instanceof HTMLInputElement && !/^(range|checkbox|radio|button|submit)$/.test(t.type)));

export function useFlowKeys(actions: FlowActions, blocked: boolean): void {
  const store = useCanvasStoreApi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || blocked) return;
      const s = store.getState();
      if (s.searchOpen) return;
      const onSelect = e.target instanceof HTMLSelectElement; // Esc closes an open list natively
      if (e.key === 'Escape' && (s.flow || s.flowPicker) && !onSelect) {
        if (s.flowPicker) actions.closePicker();
        else actions.exit();
        e.preventDefault();
      } else if ((e.key === 't' || e.key === 'T') && !s.focus && !onSelect) {
        if (!(s.selectedNodeId && actions.enter(s.selectedNodeId, e.shiftKey ? 'in' : undefined))) {
          if (s.flow || s.flowPicker) return;
          actions.openPicker();
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, blocked, store]);
}
