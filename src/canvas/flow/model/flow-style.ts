/**
 * How a hop is drawn: stroke colour, width, dash pattern and opacity from its kind, confidence and
 * emphasis state. Colours are fixed mid-tones that read on both themes (the arrowheads are SVG markers
 * and cannot use CSS variables).
 */
import type { FlowEdge, FlowEdgeState } from '../../../contracts/canvas/index.js';

export const FLOW_COLORS = {
  normal: '#7686a3',
  seen: '#98a3b8',
  active: '#6366f1',
  ambiguous: '#d98a1d',
  unresolved: '#c0717c',
  cycle: '#a15bd6',
} as const;

export interface EdgeLook {
  stroke: string;
  width: number;
  dash?: string;
  opacity: number;
}

const DASH = { dashed: '7 5', dotted: '2 4' } as const;

export function edgeLook(edge: Pick<FlowEdge, 'kind' | 'lowConfidence'>, state: FlowEdgeState): EdgeLook {
  const lit = state === 'path' || state === 'active';
  const base = edge.kind === 'ambiguous' ? FLOW_COLORS.ambiguous : edge.kind === 'unresolved' ? FLOW_COLORS.unresolved : edge.kind === 'cycle' ? FLOW_COLORS.cycle : edge.kind === 'seen' ? FLOW_COLORS.seen : FLOW_COLORS.normal;
  const dash = edge.kind === 'ambiguous' || edge.kind === 'unresolved' ? DASH.dashed : edge.kind === 'cycle' ? '6 3' : edge.lowConfidence ? DASH.dotted : undefined;
  const stroke = state === 'active' || (state === 'path' && edge.kind === 'normal') ? FLOW_COLORS.active : base;
  const width = state === 'active' ? 3 : lit ? 2.4 : edge.kind === 'seen' ? 1.2 : 1.7;
  const opacity = state === 'dim' ? 0.14 : state === 'done' ? 0.95 : edge.kind === 'seen' ? 0.75 : 0.92;
  return { stroke, width, ...(dash ? { dash } : {}), opacity };
}
