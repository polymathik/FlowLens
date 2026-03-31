/**
 * Animated red dashed edge for dependency cycles.
 * Uses a CSS animation (dashmove) to scroll the dash pattern,
 * making cycle edges immediately recognizable.
 */
import React from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export const CycleEdge = React.memo(
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
          strokeWidth: 2,
          strokeDasharray: '5 5',
          animation: 'dashmove 1s linear infinite',
        }}
      />
    );
  },
);
