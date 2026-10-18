/**
 * Right-click menu of zones and file cards.
 *  - zone: rename, colour (six swatches), collapse / expand by default, open
 *  - file: move to another zone (pins it there), remove the pin, open
 * Edits go through `useApplyZoneOverride` (optimistic, rolled back on failure).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { Hierarchy } from '../../../contracts/hierarchy.js';
import type { MapView } from '../../../contracts/canvas/index.js';
import { ZONE_COLOR_SLOTS } from '../../../contracts/zones.js';
import { useCanvasStore } from '../../store/canvas-store';
import { useApplyZoneOverride } from '../../hooks/useZoneOverrides';
import { collapseZone, pinFile, recolorZone, renameZone, unpinFile, zoneRef } from '../../utils/zone-overrides';
import { expansionKey, zoneItemIds } from '../../utils/zone-cut';
import { pathTo } from '../../../analysis/hierarchy/index.js';
import { focusIdOf, useFocusActions } from '../../focus/focus-actions';

export interface MenuTarget {
  nodeId: string;
  x: number;
  y: number;
}

type Mode = 'main' | 'rename' | 'move';

export function ZoneMenu({ target, view, hierarchy, onClose }: { target: MenuTarget; view: MapView; hierarchy: Hierarchy; onClose: () => void }) {
  const apply = useApplyZoneOverride();
  const focusActions = useFocusActions(hierarchy);
  const setDrillPath = useCanvasStore((s) => s.setDrillPath);
  const overrides = useCanvasStore((s) => s.zoneOverrides);
  const setZoneExpansion = useCanvasStore((s) => s.setZoneExpansion);
  const [mode, setMode] = useState<Mode>('main');
  const ref = useRef<HTMLDivElement>(null);
  const zoning = view.zoning;
  const item = view.cut?.items.find((i) => i.id === target.nodeId);
  const zones = zoning?.zoneSet.zones ?? [];
  const zone = item?.kind === 'zone' ? zones.find((z) => z.id === item.zoneId) : undefined;
  const filePath = item?.kind === 'file' ? hierarchy.nodes.get(item.id)?.path : undefined;
  const [name, setName] = useState(zone?.label ?? '');

  useEffect(() => {
    const away = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', away);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', away);
    };
  }, [onClose]);

  if (!zoning || !item) return null;
  const done = (p: Promise<void>) => void p.finally(onClose);
  const zref = zone ? zoneRef(zoning.mode, zone.key) : '';
  const open = () => {
    const id = item.hierarchyId;
    if (id && hierarchy.nodes.has(id)) setDrillPath(pathTo(hierarchy, id));
    onClose();
  };
  const focusItem = (
    <button role="menuitem" data-testid="zone-menu-focus" onClick={() => { focusActions.enter(item.kind === 'zone' ? (item.hierarchyId ?? item.zoneId) : item.id); onClose(); }}>
      Focus on this
    </button>
  );
  const style: React.CSSProperties = { left: Math.min(target.x, window.innerWidth - 230), top: Math.min(target.y, window.innerHeight - 260), ['--z' as string]: 'var(--fl-zone-5)' };
  const ids = zoneItemIds(hierarchy, zoning.zoneSet, view.containerId);
  const pinned = filePath ? overrides.pins[filePath] : undefined;

  return (
    <div ref={ref} className="fl-zone-menu" data-testid="zone-menu" role="menu" style={style}>
      {mode === 'rename' && zone && (
        <form
          style={{ padding: 6, display: 'flex', gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            done(apply((o) => renameZone(o, zref, name)));
          }}
        >
          <input autoFocus data-testid="zone-rename-input" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" style={{ width: 'auto' }}>Save</button>
        </form>
      )}
      {mode === 'main' && zone && (
        <>
          <button role="menuitem" data-testid="zone-menu-rename" onClick={() => setMode('rename')}>Rename…</button>
          <div className="swatches" role="group" aria-label="Colour">
            {Array.from({ length: ZONE_COLOR_SLOTS }, (_, c) => (
              <button
                key={c}
                className="swatch"
                data-testid={`zone-color-${c}`}
                aria-label={`Colour ${c + 1}`}
                aria-pressed={zone.colorIndex === c}
                style={{ ['--z' as string]: `var(--fl-zone-${c})` }}
                onClick={() => done(apply((o) => recolorZone(o, zref, c)))}
              />
            ))}
          </div>
          <button role="menuitem" data-testid="zone-menu-collapse" onClick={() => {
              // "by default": persist the override and drop the session choice so it takes effect now.
              setZoneExpansion({ [expansionKey(view.containerId, item.id)]: !item.expanded });
              done(apply((o) => collapseZone(o, zref, item.expanded)));
            }}
          >
            {item.expanded ? 'Collapse by default' : 'Expand by default'}
          </button>
          {focusIdOf(hierarchy, item.hierarchyId ?? item.zoneId) && focusItem}
          {item.hierarchyId && <button role="menuitem" onClick={open}>Open</button>}
        </>
      )}
      {mode === 'main' && filePath && (
        <>
          <button role="menuitem" data-testid="zone-menu-move" onClick={() => setMode('move')}>Move to zone…</button>
          {pinned && <button role="menuitem" onClick={() => done(apply((o) => unpinFile(o, filePath)))}>Remove pin</button>}
          {focusItem}
          <button role="menuitem" onClick={open}>Open</button>
        </>
      )}
      {mode === 'move' && filePath && (
        <div style={{ maxHeight: 280, overflowY: 'auto' }} data-testid="zone-move-list">
          {zones.map((z) => (
            <button key={z.id} role="menuitem" data-zone-key={z.key} title={z.key} onClick={() => done(apply((o) => pinFile(o, filePath, zoneRef(zoning.mode, z.key))))}>
              {z.label}
              <span style={{ color: 'var(--fl-faint)' }}> · {z.stats.files}</span>
              {ids.get(z.id) === item.parentId && ' (current)'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
