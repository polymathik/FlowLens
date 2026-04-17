/**
 * Relation type filter panel with checkboxes.
 * Allows users to toggle visibility of specific relation types on the canvas.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';

const ALL_TYPES = [
  'import',
  'call',
  'extend',
  'implement',
  'override',
  'mixin',
  'use',
  'contain',
  'create',
  'parameter',
  'return',
  'throw',
  'decorate',
];

export function FilterPanel() {
  const visible = useCanvasStore((s) => s.visibleRelationTypes);
  const toggle = useCanvasStore((s) => s.toggleRelationType);

  return (
    <div
      style={{
        position: 'absolute',
        top: 50,
        right: 8,
        zIndex: 10,
        padding: '8px 12px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        fontSize: 11,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Relation Filters</div>
      {ALL_TYPES.map((type) => (
        <label
          key={type}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            padding: '2px 0',
          }}
        >
          <input
            type="checkbox"
            checked={visible.has(type)}
            onChange={() => toggle(type)}
          />
          <span>{type}</span>
        </label>
      ))}
    </div>
  );
}
