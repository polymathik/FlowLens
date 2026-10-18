/**
 * Edge components:
 * - RelationEdge: bezier coloured by the edge's display type, with a text
 *   label on aggregated edges ("imports 12 · calls 3"; just the count on
 *   portal links) and a tooltip listing every relation type.
 * - CycleEdge: animated red dashes for edges inside a dependency cycle.
 * - ViolationEdge: thick red dashes for edges that break an architecture rule.
 *
 * Arrowheads come from React Flow's `markerEnd` prop (set by the transformer);
 * endpoints float on node borders (see floating.ts).
 */
import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { CanvasEdgeData } from '../../../contracts/canvas/index.js';
import { PROBLEM_COLOR, relationColor } from '../../utils/relation-colors';
import { useFloatingEndpoints } from './floating';

type CanvasEdgeProps = EdgeProps<Edge<CanvasEdgeData>>;

function useBezier(p: CanvasEdgeProps) {
  const floating = useFloatingEndpoints(p.source, p.target);
  return getBezierPath({
    sourceX: floating?.sourceX ?? p.sourceX,
    sourceY: floating?.sourceY ?? p.sourceY,
    sourcePosition: floating?.sourcePosition ?? p.sourcePosition,
    targetX: floating?.targetX ?? p.targetX,
    targetY: floating?.targetY ?? p.targetY,
    targetPosition: floating?.targetPosition ?? p.targetPosition,
    curvature: 0.25,
  });
}

function CountLabel({ x, y, text, color, title }: { x: number; y: number; text: string | number; color: string; title: string }) {
  return (
    <EdgeLabelRenderer>
      <div
        data-testid="edge-label"
        title={title}
        className="nodrag nopan"
        style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
          fontSize: 10,
          fontWeight: 600,
          color,
          backgroundColor: 'var(--fl-surface)',
          whiteSpace: 'nowrap',
          border: `1px solid ${color}40`,
          padding: '0 5px',
          borderRadius: 10,
          pointerEvents: 'all',
        }}
      >
        {text}
      </div>
    </EdgeLabelRenderer>
  );
}

function describe(data?: CanvasEdgeData): string {
  if (!data) return '';
  return `${data.count} relation${data.count === 1 ? '' : 's'}: ${data.label ?? data.types.join(', ')}`;
}

export const RelationEdge = React.memo((props: CanvasEdgeProps) => {
  const [path, labelX, labelY] = useBezier(props);
  const color = relationColor(props.data?.dominantType);
  const aggregated = props.data?.kind === 'aggregated-edge';
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: color, strokeWidth: aggregated ? 2 : 1.5, opacity: 0.75, ...props.style }}
      />
      {aggregated && (props.data?.count ?? 0) > 1 && (
        <CountLabel
          x={labelX}
          y={labelY}
          text={props.data!.portal ? props.data!.count : props.data!.label || props.data!.count}
          color={color}
          title={describe(props.data)}
        />
      )}
    </>
  );
});

function problemEdge(dash: string, width: number, animated: boolean) {
  return React.memo((props: CanvasEdgeProps) => {
    const [path, labelX, labelY] = useBezier(props);
    return (
      <>
        <BaseEdge
          id={props.id}
          path={path}
          markerEnd={props.markerEnd}
          style={{
            stroke: PROBLEM_COLOR,
            strokeWidth: width,
            strokeDasharray: dash,
            animation: animated ? 'dashmove 1s linear infinite' : undefined,
          }}
        />
        {(props.data?.count ?? 0) > 1 && (
          <CountLabel x={labelX} y={labelY} text={props.data!.count} color={PROBLEM_COLOR} title={describe(props.data)} />
        )}
      </>
    );
  });
}

export const CycleEdge = problemEdge('6 4', 2.25, true);
export const ViolationEdge = problemEdge('9 4', 2.75, false);

export const edgeTypes = {
  relation: RelationEdge,
  cycle: CycleEdge,
  violation: ViolationEdge,
};
