/** "Trace from here" and "Who triggers this?" buttons of the detail panel (next to "Focus on this"). */
import React from 'react';
import type { Entity } from '../../contracts/entities.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { button } from '../components/shared/ui';
import { flowTargetOf, useFlowActions } from './flow-actions';

export function TraceFromHere({ nodeId, hierarchy, entityById }: { nodeId: string; hierarchy: Hierarchy; entityById: Map<string, Entity> }) {
  const actions = useFlowActions(hierarchy, entityById);
  const target = flowTargetOf(hierarchy, entityById, nodeId);
  if (!target) return null;
  const folder = target.kind === 'picker';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <button type="button" data-testid="detail-trace" style={button} onClick={() => actions.enter(nodeId, 'out')} title={folder ? 'List the entry points declared in here (T)' : 'See what happens when this runs (T)'}>
        {folder ? 'Entry points in here…' : 'Trace from here'}
      </button>
      {!folder && (
        <button type="button" data-testid="detail-triggers" style={button} onClick={() => actions.enter(nodeId, 'in')} title="Follow the callers up to the entry points that start this (Shift+T)">
          Who triggers this?
        </button>
      )}
    </div>
  );
}
