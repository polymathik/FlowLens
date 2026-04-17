/**
 * Detail panel for the currently selected entity.
 * Shows name, kind, file location, visibility, metrics, and annotation data.
 */
import React from 'react';
import { useCanvasStore } from '../../store/canvas-store';
import { EntityIcon } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import type { Entity } from '../../api/graph-client';

export function DetailPanel({ entities }: { entities: Entity[] }) {
  const selectedId = useCanvasStore((s) => s.selectedNodeId);
  const entity = entities.find((e) => e.id === selectedId);

  if (!entity) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        padding: '12px 16px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        fontSize: 12,
        width: 280,
        maxHeight: '50vh',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 8,
        }}
      >
        <EntityIcon kind={entity.kind} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{entity.name}</span>
        <MetricsBadge score={entity.metrics?.quality_score} />
      </div>
      <div style={{ color: '#64748b', marginBottom: 8 }}>
        {entity.qualified_name}
      </div>
      <div style={{ fontSize: 11 }}>
        <div>Kind: {entity.kind}</div>
        <div>File: {entity.file}</div>
        <div>
          Lines: {entity.location?.line_start}&ndash;
          {entity.location?.line_end}
        </div>
        <div>Visibility: {entity.visibility}</div>
        <div>Language: {entity.language}</div>
        {entity.metrics && (
          <>
            <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
              Metrics
            </div>
            {entity.metrics.cognitive_complexity !== undefined && (
              <div>
                Cognitive Complexity: {entity.metrics.cognitive_complexity}
              </div>
            )}
            {entity.metrics.line_count !== undefined && (
              <div>Line Count: {entity.metrics.line_count}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
