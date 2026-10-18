/**
 * Top toolbar: product name, overlay picker, search, filters, rules editor
 * and image export. Plain-language labels; data names stay in code.
 */
import React from 'react';
import type { OverlayType } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { DETAIL_LABELS } from '../../utils/zoom';
import { COLORS, button, buttonActive, input } from '../shared/ui';

export const OVERLAY_OPTIONS: Array<{ value: OverlayType | null; label: string }> = [
  { value: null, label: 'No overlay' },
  { value: 'complexity-heatmap', label: 'Code quality' },
  { value: 'churn-heatmap', label: 'Recent changes (churn)' },
  { value: 'hotspot', label: 'Hotspots' },
  { value: 'cycles', label: 'Dependency cycles' },
  { value: 'architecture-violations', label: 'Rule breaks' },
  { value: 'interface-diff', label: 'API changes since…' },
];

interface ToolbarProps {
  showFilter: boolean;
  showRules: boolean;
  onToggleFilter: () => void;
  onToggleRules: () => void;
  onExport: (format: 'png' | 'svg') => void;
  exporting: boolean;
}

export function Toolbar({ showFilter, showRules, onToggleFilter, onToggleRules, onExport, exporting }: ToolbarProps) {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const setOverlay = useCanvasStore((s) => s.setOverlay);
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const diffSha = useCanvasStore((s) => s.diffSha);
  const setDiffSha = useCanvasStore((s) => s.setDiffSha);
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen);

  return (
    <div
      role="toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 14px',
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: COLORS.text }}>FlowLens</span>
        <span data-testid="detail-tier" style={{ color: COLORS.faint }}>
          {DETAIL_LABELS[tier]}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button data-testid="search-button" style={button} onClick={() => setSearchOpen(true)} title="Search symbols (Ctrl/Cmd+K)">
          Search <span style={{ color: COLORS.faint, marginLeft: 4 }}>⌘K</span>
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.muted }}>
          Overlay
          <select
            data-testid="overlay-select"
            value={overlay ?? ''}
            onChange={(e) => setOverlay((e.target.value || null) as OverlayType | null)}
            style={{ ...input, width: 'auto', padding: '4px 6px' }}
          >
            {OVERLAY_OPTIONS.map((o) => (
              <option key={o.value ?? 'none'} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {overlay === 'interface-diff' && (
          <input
            type="text"
            placeholder="Snapshot SHA"
            value={diffSha}
            onChange={(e) => setDiffSha(e.target.value.trim())}
            style={{ ...input, width: 120 }}
          />
        )}
        <button style={showFilter ? buttonActive : button} onClick={onToggleFilter}>
          Relations
        </button>
        <button data-testid="rules-button" style={showRules ? buttonActive : button} onClick={onToggleRules}>
          Rules
        </button>
        <button data-testid="export-png" style={button} disabled={exporting} onClick={() => onExport('png')}>
          PNG
        </button>
        <button data-testid="export-svg" style={button} disabled={exporting} onClick={() => onExport('svg')}>
          SVG
        </button>
      </div>
    </div>
  );
}
