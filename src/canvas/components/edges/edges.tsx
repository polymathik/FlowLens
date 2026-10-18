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
import { useCanvasStore } from '../../store/canvas-store';
import { useFloatingEndpoints, useRightSideEndpoints } from './floating';

/** Opacity of an edge: strong when it touches the hovered / selected node, ~10% while others are focused, dimmed card-level edges across frames. */
export function edgeOpacity(layer: CanvasEdgeData['layer'], hot: boolean | undefined, focusActive: boolean): number {
  if (hot) return 1;
  if (focusActive) return 0.1;
  return layer === 'detail' ? 0.16 : layer === 'portal' ? 0.4 : layer === 'sibling' ? 0.55 : layer === 'bundle' ? 0.85 : layer === 'focus' ? 0.8 : 0.75;
}

type CanvasEdgeProps = EdgeProps<Edge<CanvasEdgeData>>;

type PathTriple = [path: string, labelX: number, labelY: number];

/**
 * Edge path. Normally a bezier between the floating border points; with `data.bulgeX` (layers stack) a
 * C-shaped curve that leaves the right side of both boxes and swings out to `bulgeX`, so it passes
 * around the layers in between. `data.curve` overrides the curvature (a rule-break edge beside the normal one).
 */
function useEdgePath(p: CanvasEdgeProps): PathTriple {
  const floating = useFloatingEndpoints(p.source, p.target);
  const side = useRightSideEndpoints(p.source, p.target);
  const bulge = p.data?.bulgeX;
  if (bulge !== undefined && side) {
    const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = side;
    return [`M ${sx},${sy} C ${bulge},${sy} ${bulge},${ty} ${tx},${ty}`, (sx + tx + 6 * bulge) / 8, (sy + ty) / 2];
  }
  const [path, labelX, labelY] = getBezierPath({
    sourceX: floating?.sourceX ?? p.sourceX,
    sourceY: floating?.sourceY ?? p.sourceY,
    sourcePosition: floating?.sourcePosition ?? p.sourcePosition,
    targetX: floating?.targetX ?? p.targetX,
    targetY: floating?.targetY ?? p.targetY,
    targetPosition: floating?.targetPosition ?? p.targetPosition,
    curvature: p.data?.curve ?? 0.25,
  });
  return [path, labelX, labelY];
}

function CountLabel({ x, y, text, color, title, opacity = 1 }: { x: number; y: number; text: string | number; color: string; title: string; opacity?: number }) {
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
          opacity,
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
  const [path, labelX, labelY] = useEdgePath(props);
  const focusActive = useCanvasStore((s) => s.hoveredNodeId !== null || s.selectedNodeId !== null);
  const color = relationColor(props.data?.dominantType);
  const aggregated = props.data?.kind === 'aggregated-edge';
  const layer = props.data?.layer;
  const opacity = edgeOpacity(layer, props.data?.hot, focusActive);
  // Card-level edges across frames stay unlabelled until they are hot; bundles and siblings carry their counts.
  const labelled = (layer === 'focus' && (!props.data?.crowded || props.data?.hot || (props.data?.count ?? 0) > 1)) || (layer !== 'focus' && aggregated && ((props.data?.count ?? 0) > 1 || layer === 'bundle') && (layer !== 'detail' || props.data?.hot));
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ stroke: color, strokeWidth: aggregated ? 2 : 1.5, ...props.style, opacity, ...(props.data?.hot ? { strokeWidth: Number(props.style?.strokeWidth ?? 2) + 0.75 } : {}) }}
      />
      {labelled && (
        <CountLabel
          x={labelX}
          y={labelY}
          text={props.data!.portal ? props.data!.count : props.data!.label || props.data!.count}
          color={color}
          title={describe(props.data)}
          opacity={opacity < 0.5 ? 0.25 : 1}
        />
      )}
    </>
  );
});

function problemEdge(dash: string, width: number, animated: boolean) {
  return React.memo((props: CanvasEdgeProps) => {
    const [path, labelX, labelY] = useEdgePath(props);
    const focusActive = useCanvasStore((s) => s.hoveredNodeId !== null || s.selectedNodeId !== null);
    // Zone views draw problem edges in their layer's strength (card-level ones across frames stay faint); the flat view keeps them solid.
    const opacity = props.data?.layer ? edgeOpacity(props.data.layer, props.data.hot, focusActive) : 1;
    return (
      <>
        <BaseEdge
          id={props.id}
          path={path}
          markerEnd={props.markerEnd}
          style={{
            opacity,
            stroke: PROBLEM_COLOR,
            strokeWidth: props.style?.strokeWidth ?? width,
            strokeDasharray: dash,
            animation: animated ? 'dashmove 1s linear infinite' : undefined,
          }}
        />
        {(props.data?.breakLabel || (props.data?.count ?? 0) > 1) && (props.data?.layer !== 'detail' || props.data?.hot) && (
          <CountLabel x={labelX} y={labelY} text={props.data!.breakLabel ?? props.data!.count} color={PROBLEM_COLOR} title={props.data?.ruleText ?? describe(props.data)} />
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
