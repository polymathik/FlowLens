/** "Focus on this" button of the detail panel: Focus mode centred on the selected node. */
import React from 'react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { button } from '../components/shared/ui';
import { useFocusActions } from './focus-actions';

export function FocusOnThis({ nodeId, hierarchy }: { nodeId: string; hierarchy: Hierarchy }) {
  const actions = useFocusActions(hierarchy);
  if (!actions.canFocus(nodeId)) return null;
  return (
    <button type="button" data-testid="detail-focus" style={{ ...button, marginBottom: 8 }} onClick={() => actions.enter(nodeId)} title="Show only this item and what it is connected to (F)">
      Focus on this
    </button>
  );
}
