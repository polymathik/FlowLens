/**
 * File-level node component.
 * Displays filename, entity count, and optional quality score.
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import React from 'react';
import { MetricsBadge } from '../shared/MetricsBadge';

export type FileNodeData = {
  label: string;
  entityCount: number;
  filePath: string;
  qualityScore?: number;
};

export type FileNodeType = Node<FileNodeData, 'file'>;

export const FileNode = React.memo(
  ({ data, selected }: NodeProps<FileNodeType>) => (
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
      <div style={{ fontSize: 10, color: '#94a3b8' }}>
        {data.entityCount} entities
        {data.qualityScore !== undefined && (
          <>
            {' \u00B7 '}
            <MetricsBadge score={data.qualityScore} />
          </>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  ),
);
