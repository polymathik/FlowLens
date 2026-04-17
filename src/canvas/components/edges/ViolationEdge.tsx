/**
 * Red dashed edge for architecture violations.
 * Visually distinct from normal relation edges to highlight rule breaches.
 */
import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export const ViolationEdge = React.memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  }: EdgeProps) => {
    const [edgePath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    return (
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: '#ef4444',
          strokeWidth: 2.5,
          strokeDasharray: '8 4',
        }}
      />
    );
  },
);
