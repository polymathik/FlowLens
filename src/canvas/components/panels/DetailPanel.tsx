/**
 * Details for the selected symbol: name, location, metrics in plain words.
 */
import React from 'react';
import type { Entity } from '../../api/graph-client';
import { useCanvasStore } from '../../store/canvas-store';
import { EntityIcon } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import { COLORS, floatingPanel, linkButton } from '../shared/ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ color: COLORS.muted }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

const round = (n: number) => (Math.round(n * 100) / 100).toString();

export function DetailPanel({ entityById }: { entityById: Map<string, Entity> }) {
  const selectedId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const entity = selectedId ? entityById.get(selectedId) : undefined;
  if (!entity) return null;
  const m = entity.metrics;

  return (
    <div data-testid="detail-panel" style={{ ...floatingPanel, bottom: 16, left: 16, padding: '12px 16px', width: 300, maxHeight: '50vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <EntityIcon kind={entity.kind} />
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entity.name}</span>
        <MetricsBadge score={m?.quality_score} />
        <button aria-label="Close details" style={{ ...linkButton, color: COLORS.faint }} onClick={() => selectNode(null)}>
          ×
        </button>
      </div>
      <div style={{ color: COLORS.muted, marginBottom: 8, fontSize: 11, wordBreak: 'break-all' }}>{entity.qualified_name}</div>
      <Row label="Kind" value={entity.kind} />
      <Row label="File" value={entity.file} />
      <Row label="Lines" value={`${entity.location?.line_start}–${entity.location?.line_end}`} />
      <Row label="Visibility" value={entity.visibility} />
      {m?.cognitive_complexity !== undefined && <Row label="Complexity (how hard to follow)" value={m.cognitive_complexity} />}
      {m?.line_count !== undefined && <Row label="Line count" value={m.line_count} />}
      {m?.churn_rate !== undefined && <Row label="Changes per day (90 d)" value={round(m.churn_rate)} />}
      {m?.hotspot_score !== undefined && <Row label="Hotspot score" value={round(m.hotspot_score)} />}
    </div>
  );
}
