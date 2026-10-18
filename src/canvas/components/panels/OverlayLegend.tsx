/**
 * Legend for the active overlay — always shown while an overlay is on,
 * including a note when the data it needs is missing (e.g. no git history
 * for churn/hotspots).
 */
import React from 'react';
import type { Node } from '@xyflow/react';
import type { NodeOverlayStyle, OverlayType } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { QUALITY_BANDS, churnColor } from '../../utils/color-scales';
import { PROBLEM_COLOR } from '../../utils/relation-colors';
import { DIFF_COLORS } from '../../overlays/apply-overlay';
import { OVERLAY_OPTIONS } from './Toolbar';
import { COLORS, floatingPanel, sectionTitle } from '../shared/ui';

interface Entry {
  color: string;
  label: string;
  dashed?: boolean;
}

const LEGENDS: Record<OverlayType, Entry[]> = {
  'complexity-heatmap': QUALITY_BANDS.map((b) => ({ color: b.color, label: b.label })),
  'churn-heatmap': [
    { color: churnColor(0, 1), label: 'rarely changed' },
    { color: churnColor(1, 1), label: 'changed most often' },
  ],
  hotspot: [
    { color: churnColor(0.2, 1), label: 'mild' },
    { color: churnColor(1, 1), label: 'complex and often changed (larger)' },
  ],
  cycles: [{ color: PROBLEM_COLOR, label: 'part of a dependency cycle', dashed: true }],
  'architecture-violations': [{ color: PROBLEM_COLOR, label: 'breaks an architecture rule', dashed: true }],
  'interface-diff': [
    { color: DIFF_COLORS.added, label: 'added' },
    { color: DIFF_COLORS.removed, label: 'removed / breaking' },
    { color: DIFF_COLORS.modified, label: 'modified' },
    { color: DIFF_COLORS.visibility, label: 'visibility changed' },
  ],
};

const EMPTY_NOTE: Partial<Record<OverlayType, string>> = {
  'churn-heatmap': 'No change history here (needs git history at index time).',
  hotspot: 'No hotspots here (needs git history at index time).',
  'complexity-heatmap': 'No quality scores for these items.',
  cycles: 'No cycles at this level.',
  'architecture-violations': 'No rule breaks at this level.',
  'interface-diff': 'Enter a snapshot SHA to compare against.',
};

export function OverlayLegend({ nodes }: { nodes: Node[] }) {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  if (!overlay) return null;

  const hits = nodes.filter((n) => {
    const o = (n.data as { overlay?: NodeOverlayStyle }).overlay;
    return o !== undefined && !o.muted;
  }).length;
  const label = OVERLAY_OPTIONS.find((o) => o.value === overlay)?.label ?? overlay;

  return (
    <div data-testid="overlay-legend" style={{ ...floatingPanel, bottom: 132, right: 16, padding: '10px 14px', maxWidth: 260 }}>
      <div style={sectionTitle}>{label}</div>
      {LEGENDS[overlay].map(({ color, label: text, dashed }) => (
        <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span style={{ width: 14, height: 10, borderRadius: 3, border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, background: `${color}22` }} />
          <span>{text}</span>
        </div>
      ))}
      <div data-testid="overlay-legend-count" style={{ marginTop: 6, color: hits ? COLORS.muted : COLORS.faint }}>
        {hits ? `${hits} of ${nodes.length} highlighted here` : EMPTY_NOTE[overlay]}
      </div>
    </div>
  );
}
