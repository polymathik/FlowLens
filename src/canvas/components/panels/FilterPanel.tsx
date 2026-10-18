/**
 * Relation-type filter: toggles which kinds of relations draw edges.
 * Aggregated edges stay visible while any of their types is on.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';
import { ALL_RELATION_TYPES, RELATION_COLORS } from '../../utils/relation-colors';
import { floatingPanel, sectionTitle } from '../shared/ui';

export function FilterPanel() {
  const visible = useCanvasStore((s) => s.visibleRelationTypes);
  const toggle = useCanvasStore((s) => s.toggleRelationType);

  return (
    <div data-testid="filter-panel" style={{ ...floatingPanel, top: 12, right: 12, padding: '10px 14px', maxHeight: '60vh', overflowY: 'auto' }}>
      <div style={sectionTitle}>Show relations</div>
      {ALL_RELATION_TYPES.map((type) => (
        <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0' }}>
          <input type="checkbox" checked={visible.has(type)} onChange={() => toggle(type)} />
          <span style={{ width: 10, height: 3, borderRadius: 2, background: RELATION_COLORS[type] }} />
          <span>{type}</span>
        </label>
      ))}
    </div>
  );
}
