/**
 * Module/subdirectory node component.
 * Represents a subdirectory within a top-level system directory
 * (e.g., src/parser, src/graph, src/analysis).
 *
 * Teal/green background to be visually distinct from:
 * - System nodes (indigo)
 * - File nodes (blue)
 * - Entity nodes (white with colored border)
 *
 * Semantic zoom behavior:
 * - system: compact (just module name + count)
 * - module+: expanded with quality badge
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import React from 'react';
import { MetricsBadge } from '../shared/MetricsBadge';
import { useCanvasStore } from '../../store/canvas-store';

export type ModuleNodeData = {
  label: string;
  entityCount: number;
  qualityScore?: number;
  /** System node this module belongs to (used for drill-down filtering). */
  parentSystem: string;
};

export type ModuleNodeType = Node<ModuleNodeData, 'module'>;

export const ModuleNode = React.memo(
  ({ data, selected }: NodeProps<ModuleNodeType>) => {
    const zoomLevel = useCanvasStore((s) => s.currentZoomLevel);
    const showExpanded = zoomLevel !== 'system';

    return (
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 7,
          border: `2px solid ${selected ? '#5eead4' : '#0d9488'}`,
          backgroundColor: selected ? '#0f766e' : '#0d9488',
          minWidth: 140,
          textAlign: 'center',
          color: '#ffffff',
        }}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div
          style={{
            fontWeight: 700,
            fontSize: showExpanded ? 15 : 13,
            color: '#ffffff',
          }}
        >
          {data.label}
        </div>
        <div style={{ fontSize: 11, color: '#ccfbf1', marginTop: 3 }}>
          {data.entityCount} entities
          {showExpanded &&
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
