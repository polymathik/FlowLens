/** Shown in the toolbar area when the map is grouped by layers but `.flowlens/architecture.json` defines none. */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';
import { COLORS, linkButton } from '../shared/ui';

export function LayersEmptyState({ onOpenRules }: { onOpenRules: () => void }) {
  const groupBy = useCanvasStore((s) => s.groupBy);
  const layers = useCanvasStore((s) => s.architectureLayers);
  if (groupBy !== 'layers' || layers === null || layers.length > 0) return null;
  return (
    <div
      data-testid="layers-empty"
      role="status"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', border: `1px dashed ${COLORS.border}`, borderRadius: 8, color: COLORS.muted, whiteSpace: 'nowrap' }}
    >
      No layers defined —
      <button type="button" data-testid="layers-empty-open" style={{ ...linkButton, color: COLORS.accent }} onClick={onOpenRules}>
        Rules → suggest layers
      </button>
    </div>
  );
}
