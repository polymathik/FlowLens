/** Toolbar button: trace the selected item, or open the entry-point picker when nothing traceable is selected; leaves Flow mode when it is already on (key `T`). */
import React from 'react';
import { useCanvasStore } from '../store/canvas-store';
import { button, buttonActive } from '../components/shared/ui';
import type { FlowActions } from './flow-actions';

export function FlowButton({ actions }: { actions: FlowActions }) {
  const picker = useCanvasStore((s) => s.flowPicker !== null);
  const on = actions.active;
  return (
    <button
      type="button"
      data-testid="flow-button"
      style={on || picker ? buttonActive : button}
      aria-pressed={on}
      title={on ? 'Leave Flow mode (Esc)' : 'See what happens when something runs: pick an entry point (T)'}
      onClick={() => {
        if (on) actions.exit();
        else if (picker) actions.closePicker();
        else actions.openPicker();
      }}
    >
      Flow <span style={{ opacity: 0.6, marginLeft: 4 }}>T</span>
    </button>
  );
}
