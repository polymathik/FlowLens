/**
 * View model + layout + emphasis → React Flow nodes and edges. Lane bands first (behind), then cards;
 * one edge per hop. Pure: the components only render what is described here.
 */
import type { Edge, Node } from '@xyflow/react';
import type {
  FlowCardData, FlowCardState, FlowEdgeData, FlowEdgeState, FlowLaneData, FlowModel,
} from '../../../contracts/canvas/index.js';
import { arrowMarker } from '../../utils/relation-colors';
import type { FlowEmphasis } from './flow-emphasis.js';
import { edgeLook } from './flow-style.js';
import type { FlowLayout, Rect } from './flow-layout.js';

export const FLOW_NODE_TYPES = { card: 'flowCard', lane: 'flowLane' } as const;
export const FLOW_EDGE_TYPE = 'flowHop';
export const laneNodeId = (laneId: string): string => `flow-lane:${laneId}`;

/** Above this many hops the step numbers are shown only on hover, selection and step-through. */
export const DENSE_HOPS = 60;

export interface FlowElementOptions {
  emphasis?: FlowEmphasis | null;
  /** Quality score (0..100) of an entity, when indexed. */
  quality?: (entityId: string) => number | undefined;
  /** Card whose candidate list is open. */
  openCandidates?: string | null;
  /** Always show step numbers (step-through is on). */
  forceSteps?: boolean;
}

export interface FlowElements {
  nodes: Node[];
  edges: Edge<FlowEdgeData>[];
}

/** Handle ids of a card: caller side `out-*`, callee side `in-*`. A back-reference leaves by the left and arrives on the right. */
export function hopHandles(from: Rect, fromCol: number, to: Rect, toCol: number): { source: string; target: string } {
  if (toCol > fromCol) return { source: 'out-r', target: 'in-l' };
  if (toCol < fromCol) return { source: 'out-l', target: 'in-r' };
  return to.y >= from.y ? { source: 'out-b', target: 'in-t' } : { source: 'out-t', target: 'in-b' };
}

export function buildFlowElements(model: FlowModel, layout: FlowLayout, opts: FlowElementOptions = {}): FlowElements {
  const dense = model.edges.length > DENSE_HOPS;
  const hueOf = new Map(model.lanes.map((l) => [l.id, l.colorIndex]));
  const cardState = (id: string): FlowCardState => opts.emphasis?.cards.get(id) ?? 'normal';
  const edgeState = (id: string): FlowEdgeState => opts.emphasis?.edges.get(id) ?? 'normal';

  const lanes: Node<FlowLaneData>[] = model.lanes.flatMap((lane) => {
    const r = layout.lanes.get(lane.id);
    if (!r) return [];
    return [{
      id: laneNodeId(lane.id), type: FLOW_NODE_TYPES.lane, position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: -1, className: 'fl-flow-lane-node',
      data: { lane, width: r.w, height: r.h }, draggable: false, selectable: false, focusable: false, deletable: false,
    }];
  });

  const cards: Node<FlowCardData>[] = model.cards.flatMap((card) => {
    const r = layout.cards.get(card.id);
    if (!r) return [];
    const open = opts.openCandidates === card.id;
    return [{
      id: card.id, type: FLOW_NODE_TYPES.card, position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: open ? 50 : 1,
      data: { card, hue: hueOf.get(card.laneId) ?? 5, state: cardState(card.id), candidatesOpen: open, ...(card.entityId && opts.quality?.(card.entityId) !== undefined ? { quality: opts.quality(card.entityId) } : {}) },
      draggable: false, deletable: false,
    }];
  });

  const colOf = new Map(model.cards.map((c) => [c.id, c.column]));
  const edges: Edge<FlowEdgeData>[] = model.edges.map((edge) => {
    const a = layout.cards.get(edge.from);
    const b = layout.cards.get(edge.to);
    const h = a && b ? hopHandles(a, colOf.get(edge.from) ?? 0, b, colOf.get(edge.to) ?? 0) : { source: 'out-r', target: 'in-l' };
    return {
    id: edge.id, type: FLOW_EDGE_TYPE, source: edge.from, target: edge.to, sourceHandle: h.source, targetHandle: h.target, selectable: false, focusable: false, deletable: false,
    markerEnd: arrowMarker(edgeLook(edge, edgeState(edge.id)).stroke),
    data: { edge, state: edgeState(edge.id), showStep: !dense || !!opts.forceSteps || edgeState(edge.id) !== 'normal', showLabel: !dense || ['path', 'active', 'done'].includes(edgeState(edge.id)) },
    };
  });
  return { nodes: [...lanes, ...cards], edges };
}
