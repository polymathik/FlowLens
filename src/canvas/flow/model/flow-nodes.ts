/**
 * View model + layout + emphasis → React Flow nodes and edges. Lane bands first (behind), then cards;
 * one edge per hop. Pure: the components only render what is described here.
 */
import type { Edge, Node } from '@xyflow/react';
import type {
  FlowCardData, FlowCardState, FlowEdgeData, FlowEdgeState, FlowLaneData, FlowModel,
} from '../../../contracts/canvas/index.js';
import type { FlowEmphasis } from './flow-emphasis.js';
import type { FlowLayout } from './flow-layout.js';

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

const BACK_LOOPS = 4;

export function buildFlowElements(model: FlowModel, layout: FlowLayout, opts: FlowElementOptions = {}): FlowElements {
  const dense = model.edges.length > DENSE_HOPS;
  const cardState = (id: string): FlowCardState => opts.emphasis?.cards.get(id) ?? 'normal';
  const edgeState = (id: string): FlowEdgeState => opts.emphasis?.edges.get(id) ?? 'normal';

  const lanes: Node<FlowLaneData>[] = model.lanes.flatMap((lane) => {
    const r = layout.lanes.get(lane.id);
    if (!r) return [];
    return [{
      id: laneNodeId(lane.id), type: FLOW_NODE_TYPES.lane, position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: -1,
      data: { lane, width: r.w, height: r.h }, draggable: false, selectable: false, focusable: false, deletable: false,
    }];
  });

  const cards: Node<FlowCardData>[] = model.cards.flatMap((card) => {
    const r = layout.cards.get(card.id);
    if (!r) return [];
    const open = opts.openCandidates === card.id;
    return [{
      id: card.id, type: FLOW_NODE_TYPES.card, position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: open ? 50 : 1,
      data: { card, state: cardState(card.id), candidatesOpen: open, ...(card.entityId && opts.quality?.(card.entityId) !== undefined ? { quality: opts.quality(card.entityId) } : {}) },
      draggable: false, deletable: false,
    }];
  });

  // Back-references take turns on a few bulge depths so several curves in one place do not coincide.
  let loop = 0;
  const edges: Edge<FlowEdgeData>[] = model.edges.map((edge) => ({
    id: edge.id, type: FLOW_EDGE_TYPE, source: edge.from, target: edge.to, selectable: false, focusable: false, deletable: false,
    data: { edge, state: edgeState(edge.id), showStep: !dense || !!opts.forceSteps || edgeState(edge.id) !== 'normal', loop: edge.back ? loop++ % BACK_LOOPS : 0 },
  }));
  return { nodes: [...lanes, ...cards], edges };
}
