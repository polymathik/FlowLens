/**
 * What is lit and what is dimmed: the path from the root to the selected card, and the step-through.
 * Pure over the view model; the result is a state per card and per edge that `flow-nodes.ts` applies.
 *
 * Path: the tree edges (`FlowEdge.tree`, the first hop that reached each card) from the root to the card;
 * everything else is dimmed. A card reached by several paths shows the first, the one the numbering follows.
 *
 * Step-through: hops in call order. At step k the first k-1 hops are `done` (their cards lit), hop k is
 * `active`, later hops and the cards only they reach are dimmed. Step 0 lights the root only.
 */
import type { FlowCardState, FlowEdgeState, FlowModel } from '../../../contracts/canvas/index.js';

export interface FlowEmphasis {
  cards: Map<string, FlowCardState>;
  edges: Map<string, FlowEdgeState>;
}

/** The card a hop newly reveals: the callee when tracing out, the caller when tracing in. */
const farOf = (model: Pick<FlowModel, 'direction'>, e: { from: string; to: string }): string => (model.direction === 'out' ? e.to : e.from);
const nearOf = (model: Pick<FlowModel, 'direction'>, e: { from: string; to: string }): string => (model.direction === 'out' ? e.from : e.to);

/** Card ids from the root to `cardId` (inclusive) and the tree edge ids between them. */
export function pathTo(model: Pick<FlowModel, 'cards' | 'edges' | 'direction' | 'rootId'>, cardId: string): { cards: string[]; edges: string[] } {
  const byId = new Map(model.cards.map((c) => [c.id, c]));
  const treeEdgeOf = new Map(model.edges.filter((e) => e.tree).map((e) => [farOf(model, e), e.id]));
  const cards: string[] = [];
  const edges: string[] = [];
  const guard = new Set<string>();
  for (let id: string | null = cardId; id && byId.has(id) && !guard.has(id); id = byId.get(id)?.parentId ?? null) {
    guard.add(id);
    cards.unshift(id);
    const edge = treeEdgeOf.get(id);
    if (edge) edges.unshift(edge);
  }
  return { cards, edges };
}

/** Dim everything except the path root → `selectedId`; null when nothing (or something unknown) is selected. */
export function emphasisForSelection(model: FlowModel, selectedId: string | null): FlowEmphasis | null {
  if (!selectedId || !model.cards.some((c) => c.id === selectedId)) return null;
  const path = pathTo(model, selectedId);
  const onCards = new Set(path.cards);
  const onEdges = new Set(path.edges);
  return {
    cards: new Map(model.cards.map((c) => [c.id, c.id === selectedId ? 'active' : onCards.has(c.id) ? 'path' : 'dim'])),
    edges: new Map(model.edges.map((e) => [e.id, onEdges.has(e.id) ? 'path' : 'dim'])),
  };
}

/** Number of steps of the step-through (one per hop, in call order). */
export const stepCount = (model: Pick<FlowModel, 'edges'>): number => model.edges.length;

/** Emphasis at `step` (0 = only the root is lit, N = every hop done). */
export function emphasisForStep(model: FlowModel, step: number): FlowEmphasis {
  const lit = new Set<string>([model.rootId]);
  const edges = new Map<string, FlowEdgeState>();
  let active: string | null = null;
  for (const e of model.edges) {
    if (e.step < step) {
      edges.set(e.id, 'done');
      lit.add(e.from).add(e.to);
    } else if (e.step === step) {
      edges.set(e.id, 'active');
      lit.add(e.from).add(e.to);
      active = farOf(model, e);
    } else edges.set(e.id, 'dim');
  }
  return {
    cards: new Map(model.cards.map((c) => [c.id, c.id === active || (step === 0 && c.id === model.rootId) ? 'active' : lit.has(c.id) ? 'path' : 'dim'])),
    edges,
  };
}

/** One sentence for the step caption: "3/6  parseSessionId() → isProviderId()  ids.ts:27". */
export function stepCaption(model: FlowModel, step: number): string {
  if (step <= 0) return `Start: ${model.cards.find((c) => c.id === model.rootId)?.entryLabel ?? model.cards.find((c) => c.id === model.rootId)?.name ?? ''}`;
  const e = model.edges.find((x) => x.step === step);
  if (!e) return '';
  const byId = new Map(model.cards.map((c) => [c.id, c]));
  const verb = e.type === 'create' ? 'creates' : 'calls';
  const near = byId.get(nearOf(model, e));
  const far = byId.get(farOf(model, e));
  const [caller, callee] = model.direction === 'out' ? [near, far] : [far, near];
  return `${step}/${model.edges.length}  ${caller?.name ?? '?'} ${verb} ${callee?.name ?? '?'}  ${e.label}`;
}
