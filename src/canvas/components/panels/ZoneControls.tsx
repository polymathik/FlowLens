/**
 * Zone controls in the toolbar: "Group by" (Packages | Folders; Communities
 * and Layers are shown but disabled — the roadmap is visible) and
 * "Expand all / Collapse all" for the open container.
 */
import React from 'react';
import { ZONING_MODES, type ZoningMode } from '../../../contracts/zones.js';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import type { MapView } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { expansionKey, zoneItemIds } from '../../utils/zone-cut';
import { COLORS, button, buttonActive } from '../shared/ui';

const LABELS: Record<ZoningMode, string> = { packages: 'Packages', folders: 'Folders', communities: 'Communities', layers: 'Layers' };
const AVAILABLE: ReadonlySet<ZoningMode> = new Set(['packages', 'folders']);
const SOON = 'Coming in a later step';

export function ZoneControls({ view, hierarchy }: { view: MapView; hierarchy: Hierarchy }) {
  const groupBy = useCanvasStore((s) => s.groupBy);
  const setGroupBy = useCanvasStore((s) => s.setGroupBy);
  const setZoneExpansion = useCanvasStore((s) => s.setZoneExpansion);
  const zoneSet = view.zoning?.zoneSet;
  const applyAll = (open: boolean) => {
    if (!zoneSet) return;
    const ids = zoneItemIds(hierarchy, zoneSet, view.containerId);
    setZoneExpansion(Object.fromEntries([...ids.values()].map((id) => [expansionKey(view.containerId, id), open])));
  };
  return (
    <div data-testid="zone-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.muted }}>
      <span>Group by</span>
      <div role="group" aria-label="Group by" style={{ display: 'inline-flex' }}>
        {ZONING_MODES.map((mode, i) => {
          const enabled = AVAILABLE.has(mode);
          const active = groupBy === mode;
          return (
            <button
              key={mode}
              type="button"
              data-testid={`group-by-${mode}`}
              aria-pressed={groupBy === mode}
              disabled={!enabled}
              title={enabled ? (view.zoning && view.zoning.mode !== groupBy && groupBy === mode ? `No ${mode} in this folder: grouped by ${view.zoning.mode}` : LABELS[mode]) : SOON}
              onClick={() => setGroupBy(mode)}
              style={{
                ...(active ? buttonActive : button),
                borderRadius: i === 0 ? '6px 0 0 6px' : i === ZONING_MODES.length - 1 ? '0 6px 6px 0' : 0,
                marginLeft: i === 0 ? 0 : -1,
                opacity: enabled ? 1 : 0.5,
                cursor: enabled ? 'pointer' : 'not-allowed',
              }}
            >
              {LABELS[mode]}
            </button>
          );
        })}
      </div>
      {zoneSet && zoneSet.zones.length > 0 && (
        <>
          <button type="button" data-testid="expand-all" style={button} onClick={() => applyAll(true)} title="Open every zone (very large ones may stay collapsed for performance)">
            Expand all
          </button>
          <button type="button" data-testid="collapse-all" style={button} onClick={() => applyAll(false)}>
            Collapse all
          </button>
        </>
      )}
    </div>
  );
}
