/**
 * Individual entity node component (class, function, method, etc.).
 * Displays kind icon, name, quality score badge, and cognitive complexity.
 *
 * Semantic zoom behavior:
 * - system/module: compact (icon + name only)
 * - file: name + kind + quality badge
 * - entity: full detail (all metrics, complexity, annotations)
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import React from 'react';
import { EntityIcon } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import { AnnotationTooltip } from '../shared/AnnotationTooltip';
import { useCanvasStore } from '../../store/canvas-store';
import type { NodeAnnotation } from '../../utils/node-transformer';

export type EntityNodeData = {
  label: string;
  kind: string;
  qualityScore?: number;
  cognitiveComplexity?: number;
  visibility: string;
  annotations?: NodeAnnotation[];
};

export type EntityNodeType = Node<EntityNodeData, 'entity'>;

export const EntityNode = React.memo(
  ({ data, selected }: NodeProps<EntityNodeType>) => {
    const zoomLevel = useCanvasStore((s) => s.currentZoomLevel);
    const isCompact = zoomLevel === 'system' || zoomLevel === 'module';
    const isFullDetail = zoomLevel === 'entity';

    return (
      <div
        style={{
          padding: '6px 10px',
          borderRadius: 4,
          border: `1px solid ${selected ? '#8b5cf6' : '#e2e8f0'}`,
          backgroundColor: selected ? '#f5f3ff' : 'white',
          fontSize: 11,
          minWidth: 100,
        }}
      >
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <EntityIcon kind={data.kind} />
          <span style={{ fontWeight: 500 }}>{data.label}</span>
          {!isCompact && data.qualityScore !== undefined && (
            <MetricsBadge score={data.qualityScore} />
          )}
        </div>
        {!isCompact && (
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
            {data.kind}
            {data.visibility !== 'public' && ` \u00B7 ${data.visibility}`}
          </div>
        )}
        {isFullDetail && data.cognitiveComplexity !== undefined && (
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
            CC: {data.cognitiveComplexity}
          </div>
        )}
        {isFullDetail && (data.annotations?.length ?? 0) > 0 && (
          <AnnotationTooltip annotations={data.annotations!} />
        )}
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    );
  },
);
