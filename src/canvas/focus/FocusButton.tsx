/** Toolbar button: focus on the selected node, or leave Focus mode when it is already on (key `F`). */
import React from 'react';
import { useCanvasStore } from '../store/canvas-store';
import { button, buttonActive } from '../components/shared/ui';
import type { FocusActions } from './focus-actions';

export function FocusButton({ actions }: { actions: FocusActions }) {
  const selected = useCanvasStore((s) => s.selectedNodeId);
  const can = actions.canFocus(selected);
  const on = actions.active;
  return (
    <button
      type="button"
      data-testid="focus-button"
      style={on ? buttonActive : button}
      disabled={!on && !can}
      aria-pressed={on}
      title={on ? 'Leave Focus mode (Esc)' : can ? 'Show only this item and what it is connected to (F)' : 'Select a file, symbol or folder first, then Focus (F)'}
      onClick={() => (on ? actions.exit() : actions.enter(selected))}
    >
      Focus <span style={{ opacity: 0.6, marginLeft: 4 }}>F</span>
    </button>
  );
}
