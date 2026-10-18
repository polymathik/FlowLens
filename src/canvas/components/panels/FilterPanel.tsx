/**
 * Relation-type filter (which kinds of relations draw edges and portals;
 * counts always cover the visible types) and the lockfile toggle.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';
import { ALL_RELATION_TYPES, RELATION_COLORS } from '../../utils/relation-colors';
import { floatingPanel, sectionTitle } from '../shared/ui';

export function FilterPanel() {
  const visible = useCanvasStore((s) => s.visibleRelationTypes);
  const toggle = useCanvasStore((s) => s.toggleRelationType);
  const showLockfiles = useCanvasStore((s) => s.showLockfiles);
  const setShowLockfiles = useCanvasStore((s) => s.setShowLockfiles);

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
      <div style={{ ...sectionTitle, marginTop: 10 }}>Files</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0' }}>
        <input data-testid="show-lockfiles" type="checkbox" checked={showLockfiles} onChange={(e) => setShowLockfiles(e.target.checked)} />
        <span>Show lockfiles (in Config)</span>
      </label>
    </div>
  );
}
