/**
 * Default edge component for relation edges.
 * Renders a colored bezier path with a relation-type label at the midpoint.
 */
import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

const TYPE_COLORS: Record<string, string> = {
  import: '#6366f1',
  call: '#22c55e',
  extend: '#f59e0b',
  implement: '#3b82f6',
  override: '#a855f7',
  contain: '#94a3b8',
  create: '#ec4899',
  use: '#64748b',
  decorate: '#14b8a6',
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
    markerEnd,
  }: EdgeProps) => {
    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    const relType = (data?.relation as { type?: string })?.type ?? 'unknown';
    const color = TYPE_COLORS[relType] ?? '#94a3b8';

    return (
      <>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{ stroke: color, strokeWidth: 1.5 }}
        />
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              color: '#64748b',
              backgroundColor: 'rgba(255,255,255,0.8)',
              padding: '1px 4px',
              borderRadius: 3,
              pointerEvents: 'none',
            }}
          >
            {relType}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  },
);
