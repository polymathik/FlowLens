/**
 * Top-level directory node component.
 * Displays directory name, entity count, and average quality score.
 *
 * Semantic zoom behavior:
 * - system: name + entity count (default)
 * - module/file/entity: expanded name + quality badge always visible
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import React from 'react';
import { MetricsBadge } from '../shared/MetricsBadge';
import { useCanvasStore } from '../../store/canvas-store';

export type SystemNodeData = {
  label: string;
  entityCount: number;
  qualityScore?: number;
};

export type SystemNodeType = Node<SystemNodeData, 'system'>;

export const SystemNode = React.memo(
  ({ data, selected }: NodeProps<SystemNodeType>) => {
    const zoomLevel = useCanvasStore((s) => s.currentZoomLevel);
    const showExpanded = zoomLevel !== 'system';

    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 8,
          border: `2px solid ${selected ? '#818cf8' : '#4f46e5'}`,
          backgroundColor: selected ? '#6366f1' : '#4f46e5',
          minWidth: 140,
          textAlign: 'center',
          color: '#ffffff',
        }}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div style={{ fontWeight: 700, fontSize: showExpanded ? 16 : 14, color: '#ffffff' }}>
          {showExpanded ? `/${data.label}` : data.label}
        </div>
        <div style={{ fontSize: 11, color: '#c7d2fe', marginTop: 4 }}>
          {data.entityCount} entities
          {(showExpanded || data.qualityScore !== undefined) &&
            data.qualityScore !== undefined && (
              <>
                {' \u00B7 '}
                <MetricsBadge score={data.qualityScore} />
              </>
            )}
        </div>
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    );
  },
);
