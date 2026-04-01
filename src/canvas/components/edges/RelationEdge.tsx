/**
 * Custom edge component for relation edges.
 *
 * Renders a colored bezier curve with:
 * - Per-relation-type color coding
 * - Custom SVG arrow markers (referenced by type)
 * - Aggregated edge count labels
 */
import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

export const TYPE_COLORS: Record<string, string> = {
  import: '#6366f1',   // indigo
  call: '#22c55e',     // green
  extend: '#f59e0b',   // amber
  implement: '#3b82f6', // blue
  override: '#a855f7', // violet
  contain: '#cbd5e1',  // light gray (subdued)
  create: '#ec4899',   // pink
  use: '#64748b',      // dark gray
  mixin: '#14b8a6',    // teal
  parameter: '#06b6d4', // cyan
  return: '#8b5cf6',   // purple
  throw: '#ef4444',    // red
  decorate: '#f97316', // orange
};

export const RelationEdge = React.memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style,
  }: EdgeProps) => {
    const relType = (data as any)?.relation?.type ?? 'import';
    const color = TYPE_COLORS[relType] ?? '#94a3b8';
    const isAggregated = (data as any)?.aggregated;

    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.3, // nice arc
    });

    return (
      <>
        <BaseEdge
          id={id}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: isAggregated ? 2 : 1.5,
            opacity: 0.7,
            ...style,
          }}
          markerEnd={`url(#arrow-${relType})`}
        />
        {/* Show count label for aggregated edges */}
        {isAggregated && (data as any)?.count > 1 && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 10,
                fontWeight: 600,
                color: color,
                backgroundColor: 'rgba(255,255,255,0.9)',
                padding: '1px 5px',
                borderRadius: 10,
                pointerEvents: 'none',
              }}
            >
              {(data as any).count}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    );
  },
);
