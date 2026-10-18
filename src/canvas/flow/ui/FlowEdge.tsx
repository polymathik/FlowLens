/**
 * One hop. Forward hops are smooth curves from the caller's right edge to the callee's left edge; a
 * back-reference (a cycle, or a function already in the picture further left) leaves by the caller's left
 * edge and arrives on the target's right edge (same column: top / bottom), never re-expanding the target. The label shows the step number and the call site
 * (`file:line`, `×N` when repeated); hovering widens it to the full path.
 */
import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { FlowEdgeData } from '../../../contracts/canvas/index.js';
import { edgeLook } from '../model/flow-style';

export const FlowEdge = React.memo(({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<Edge<FlowEdgeData>>) => {
  const [hover, setHover] = useState(false);
  if (!data) return null;
  const { edge, state } = data;
  const look = edgeLook(edge, state);
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: edge.back ? 0.5 : 0.35 });
  const showLabel = data.showLabel || hover;
  const enter = () => setHover(true);
  const leave = () => setHover(false);
  return (
    <g onMouseEnter={enter} onMouseLeave={leave} data-testid="flow-edge" data-hop={edge.id} data-state={state} data-kind={edge.kind}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={14}
        className={state === 'active' ? 'fl-flow-edge-active' : undefined}
        style={{ stroke: look.stroke, strokeWidth: look.width, opacity: look.opacity, ...(look.dash ? { strokeDasharray: look.dash } : {}) }} />
      <EdgeLabelRenderer>
        {showLabel && (
          <div className={`fl-flow-label nodrag nopan${data.showStep || hover ? '' : ' no-step'}${hover ? ' is-hover' : ''}`} onMouseEnter={enter} onMouseLeave={leave} data-testid="flow-hop" data-hop={edge.id} data-step={edge.step} data-kind={edge.kind}
            data-state={state} data-back={edge.back ? '1' : '0'} data-provenance={edge.provenance} data-dotted={edge.lowConfidence ? '1' : '0'} title={edge.explain}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, ['--lc' as string]: look.stroke }}>
            {(data.showStep || hover) && <span className="fl-flow-step">{edge.step}</span>}
            <span className="fl-flow-short">{edge.label}</span>
            <span className="fl-flow-full">{edge.ref.file}:{edge.ref.line}{edge.count > 1 ? ` ×${edge.count}` : ''}</span>
          </div>
        )}
      </EdgeLabelRenderer>
    </g>
  );
});
FlowEdge.displayName = 'FlowEdge';
