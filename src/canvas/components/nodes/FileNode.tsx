/**
 * File-level node component.
 * Displays filename, entity count, and optional quality score.
 *
 * Semantic zoom behavior:
 * - system: compact (just filename)
 * - file/entity: entity count + quality badge
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import React from 'react';
import { MetricsBadge } from '../shared/MetricsBadge';
import { useCanvasStore } from '../../store/canvas-store';

export type FileNodeData = {
  label: string;
  entityCount: number;
  filePath: string;
  qualityScore?: number;
  /** System node this file belongs to (used for drill-down filtering). */
  parentSystem?: string;
};

export type FileNodeType = Node<FileNodeData, 'file'>;

export const FileNode = React.memo(
  ({ data, selected }: NodeProps<FileNodeType>) => {
    const zoomLevel = useCanvasStore((s) => s.currentZoomLevel);
    const isCompact = zoomLevel === 'system';
    const showDetail = zoomLevel === 'file' || zoomLevel === 'entity';

    return (
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          border: `1.5px solid ${selected ? '#3b82f6' : '#cbd5e1'}`,
          backgroundColor: selected ? '#eff6ff' : 'white',
          minWidth: 120,
          fontSize: 12,
        }}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div style={{ fontWeight: 600 }}>{'\u{1F4C4}'} {data.label}</div>
        {!isCompact && (
          <div style={{ fontSize: 10, color: '#94a3b8' }}>
            {data.entityCount} entities
            {showDetail && data.qualityScore !== undefined && (
              <>
                {' \u00B7 '}
                <MetricsBadge score={data.qualityScore} />
              </>
            )}
          </div>
        )}
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    );
  },
);
