/**
 * Top toolbar with overlay selector, filter toggle, and export buttons.
 * Provides quick access to canvas-level controls and search shortcut hint.
 */
import React from 'react';
import { useCanvasStore, type OverlayType } from '../../store/canvas-store';

const OVERLAYS: Array<{ value: OverlayType; label: string }> = [
  { value: null, label: 'None' },
  { value: 'complexity-heatmap', label: 'Complexity' },
  { value: 'churn-heatmap', label: 'Churn' },
  { value: 'hotspot', label: 'Hotspots' },
  { value: 'cycles', label: 'Cycles' },
  { value: 'architecture-violations', label: 'Violations' },
  { value: 'interface-diff', label: 'Diff' },
];

const buttonStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #cbd5e1',
  cursor: 'pointer',
  fontSize: 11,
  backgroundColor: 'transparent',
};

export function Toolbar({
  onExportSVG,
  onExportPNG,
  onToggleFilter,
  onToggleArchEditor,
}: {
  onExportSVG: () => void;
  onExportPNG: () => void;
  onToggleFilter: () => void;
  onToggleArchEditor: () => void;
}) {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const setOverlay = useCanvasStore((s) => s.setOverlay);
  const zoomLevel = useCanvasStore((s) => s.currentZoomLevel);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderBottom: '1px solid #e2e8f0',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>FlowLens</span>
        <span style={{ color: '#94a3b8' }}>Zoom: {zoomLevel}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          value={overlay ?? ''}
          onChange={(e) =>
            setOverlay((e.target.value || null) as OverlayType)
          }
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
            fontSize: 11,
          }}
        >
          {OVERLAYS.map((o) => (
            <option key={o.value ?? 'none'} value={o.value ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
        <button onClick={onToggleFilter} style={buttonStyle}>
          Filters
        </button>
        <button onClick={onToggleArchEditor} style={buttonStyle}>
          Layers
        </button>
        <button onClick={onExportSVG} style={buttonStyle}>
          SVG
        </button>
        <button onClick={onExportPNG} style={buttonStyle}>
          PNG
        </button>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>Cmd+K Search</span>
      </div>
    </div>
  );
}
