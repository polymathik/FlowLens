/** Everything Flow mode adds to the Map's body: the flow overlay, the entry-point picker and the "Back to flow" chip. One hook-in for `Canvas.tsx`. */
import React from 'react';
import type { Entity } from '../../../contracts/entities.js';
import { useCanvasStore } from '../../store/canvas-store';
import { button, floatingPanel } from '../../components/shared/ui';
import type { FlowActions } from '../flow-actions';
import { EntryPicker } from './EntryPicker';
import { FlowMode } from './FlowMode';

function BackChip({ actions }: { actions: FlowActions }) {
  const back = actions.backLink;
  const setFlow = useCanvasStore((s) => s.setFlow);
  if (!back) return null;
  const title = back.resolved?.title ?? back.label ?? back.id;
  return (
    <div data-testid="flow-back" style={{ ...floatingPanel, top: 12, right: 12, zIndex: 25, padding: '4px 6px 4px 10px', display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420 }}>
      <button type="button" data-testid="flow-back-button" style={{ ...button, border: 'none', background: 'none', color: 'var(--fl-accent)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => setFlow(back)} title="Return to the flow you came from">
        ← Back to flow: {title}
      </button>
      <button type="button" aria-label="Dismiss" style={{ ...button, border: 'none', background: 'none' }} onClick={actions.clearBackLink}>×</button>
    </div>
  );
}

export function FlowLayer({ actions, entities, entityById }: { actions: FlowActions; entities: Entity[]; entityById: Map<string, Entity> }) {
  const flow = useCanvasStore((s) => s.flow !== null);
  const picker = useCanvasStore((s) => s.flowPicker !== null);
  return (
    <>
      {flow && <FlowMode actions={actions} entityById={entityById} />}
      {picker && <EntryPicker entities={entities} onPick={actions.enterEntry} onPickId={(id) => actions.enterId(id)} onClose={actions.closePicker} />}
      {!flow && <BackChip actions={actions} />}
    </>
  );
}
