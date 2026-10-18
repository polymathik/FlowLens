/**
 * Breadcrumb for the current drill path. Lives in the header row under the
 * toolbar (not floating), so it can never overlap toolbar controls.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';
import { containerLabel, fileName } from '../../utils/hierarchy';
import { COLORS, linkButton } from '../shared/ui';

function crumbLabel(id: string): string {
  const path = containerLabel(id);
  return id.startsWith('system:') ? path : fileName(path);
}

export function BreadcrumbBar() {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const drillToLevel = useCanvasStore((s) => s.drillToLevel);

  return (
    <nav aria-label="Location" data-testid="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
      <button
        onClick={() => drillToLevel(-1)}
        style={{ ...linkButton, fontWeight: 600, color: drillPath.length ? COLORS.accent : COLORS.text }}
      >
        Project
      </button>
      {drillPath.map((id, i) => {
        const last = i === drillPath.length - 1;
        return (
          <React.Fragment key={id}>
            <span style={{ color: COLORS.faint }}>/</span>
            <button
              title={containerLabel(id)}
              onClick={() => drillToLevel(i)}
              disabled={last}
              style={{ ...linkButton, color: last ? COLORS.text : COLORS.accent, fontWeight: last ? 600 : 400, cursor: last ? 'default' : 'pointer' }}
            >
              {crumbLabel(id)}
            </button>
          </React.Fragment>
        );
      })}
      {drillPath.length === 0 && (
        <span style={{ color: COLORS.faint, marginLeft: 6 }}>Double-click a box to open it</span>
      )}
    </nav>
  );
}
