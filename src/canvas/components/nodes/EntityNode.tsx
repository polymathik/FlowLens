/**
 * Symbol node (class, function, method, …). Detail grows with the semantic
 * zoom tier: kind + quality from "file", complexity + notes at "entity".
 */
import React from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { EntityNodeData } from '../../../contracts/canvas/index.js';
import { useCanvasStore } from '../../store/canvas-store';
import { EntityIcon, KIND_COLORS } from '../shared/EntityIcon';
import { MetricsBadge } from '../shared/MetricsBadge';
import { AnnotationTooltip } from '../shared/AnnotationTooltip';
import { NodeShell } from './NodeShell';

export const EntityNode = React.memo(({ data, selected }: NodeProps<Node<EntityNodeData, 'entity'>>) => {
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const compact = tier === 'system' || tier === 'module';
  const full = tier === 'entity';
  const kindLine = [data.entityKind, data.visibility !== 'public' ? data.visibility : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <NodeShell
      level="entity"
      selected={selected}
      overlay={data.overlay}
      accent={KIND_COLORS[data.entityKind] ?? '#64748b'}
      icon={<EntityIcon kind={data.entityKind} />}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {data.label}
          {!compact && <MetricsBadge score={data.qualityScore} />}
        </span>
      }
      subtitle={
        compact
          ? undefined
          : full && data.cognitiveComplexity !== undefined
            ? `${kindLine} · complexity ${data.cognitiveComplexity}`
            : kindLine
      }
      tooltip={`${data.label} (${data.entityKind}) — ${data.filePath}`}
    >
      {full && (data.annotations?.length ?? 0) > 0 && <AnnotationTooltip annotations={data.annotations!} />}
    </NodeShell>
  );
});
