/** One-line notices over the map: failed zone saves, zones collapsed for performance, grouping fallback. */
import React from 'react';
import type { MapView } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';

export function ZoneNotice({ view }: { view: MapView }) {
  const saveError = useCanvasStore((s) => s.zoneNotice);
  const setNotice = useCanvasStore((s) => s.setZoneNotice);
  const collapsed = view.cut?.budgetCollapsed ?? 0;
  const fallback = view.zoning && view.zoning.mode !== view.zoning.requested ? view.zoning : null;
  const messages = [
    saveError,
    collapsed > 0 ? `${collapsed} ${collapsed === 1 ? 'zone' : 'zones'} collapsed for performance — expand to see` : null,
    fallback ? `No ${fallback.requested} to group by here — showing ${fallback.mode}` : null,
  ].filter((m): m is string => !!m);
  if (messages.length === 0) return null;
  return (
    <div className="fl-zone-notice" data-testid="zone-notice" role="status">
      <span>{messages.join(' · ')}</span>
      {saveError && (
        <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }}>
          ×
        </button>
      )}
    </div>
  );
}
