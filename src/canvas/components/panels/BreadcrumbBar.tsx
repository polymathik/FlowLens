/**
 * Breadcrumb navigation bar shown when the user has drilled into nodes.
 * Displays the current drill path and allows navigating back to any level.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';

export function BreadcrumbBar() {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const drillUp = useCanvasStore((s) => s.drillUp);

  if (drillPath.length === 0) return null;

  const goToRoot = () => {
    const len = useCanvasStore.getState().drillPath.length;
    for (let i = 0; i < len; i++) drillUp();
  };

  const goToLevel = (index: number) => {
    const current = useCanvasStore.getState().drillPath;
    for (let j = current.length - 1; j > index; j--) drillUp();
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 10,
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        padding: '4px 8px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 6,
        fontSize: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <button
        onClick={goToRoot}
        style={{
          cursor: 'pointer',
          border: 'none',
          background: 'none',
          fontWeight: 600,
        }}
      >
        Root
      </button>
      {drillPath.map((id, i) => (
        <React.Fragment key={id}>
          <span style={{ color: '#94a3b8' }}>/</span>
          <button
            onClick={() => goToLevel(i)}
            style={{
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              color: '#3b82f6',
            }}
          >
            {id.replace(/^(system|file):/, '')}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
