/**
 * FlowTrace → view model (pure). Decides, for every node and hop of a trace, what the picture shows:
 *
 *   nodes ─► cards (column = depth, mirrored for `in`; role; lane; call-order sequence)
 *   hops  ─► edges (step number, label, style kind, back-reference?, tree edge?) + leaf cards for calls
 *            the graph could not resolve
 *   lanes ─► swimlanes with the Map's zone colours
 *   stats ─► notices (truncation, text-derived hops, unresolved calls, ambiguity)
 *
 * Nothing here draws or measures anything; `flow-layout.ts` places the result and `flow-nodes.ts` turns it
 * into React Flow nodes. No hop is dropped: every hop of the trace is exactly one edge.
 */
import type { FlowCandidate, FlowCard, FlowEdge, FlowEdgeKind, FlowLaneModel, FlowModel } from '../../../contracts/canvas/index.js';
import type { FlowHop, FlowNode, FlowTrace } from '../../../contracts/flow.js';
import { assignColors } from '../../../analysis/zones/colors.js';
import { hashKey } from '../../../analysis/zones/keys.js';
import { displayName, refLabel } from './flow-labels.js';
import { flowNotices } from './flow-notices.js';

export interface FlowModelContext {
  /** Entity lookup for candidates outside the trace. */
  entity?: (id: string) => { name: string; file: string; line: number } | undefined;
  /** The user's colour for a lane (a zone colour override), if any. */
  laneColor?: (lane: { id: string; path: string; kind: string }) => number | undefined;
}

/** Hops below this confidence, or read from source text, are drawn dotted. */
export const LOW_CONFIDENCE = 0.85;
const leafId = (hopIndex: number): string => `leaf:${hopIndex}`;

function edgeKind(h: FlowHop): FlowEdgeKind {
  if (h.resolution === 'unresolved') return 'unresolved';
  if (h.link === 'cycle') return 'cycle';
  if (h.resolution === 'ambiguous') return 'ambiguous';
  if (h.link === 'seen') return 'seen';
  return 'normal';
}

function describeEdge(h: FlowHop, kind: FlowEdgeKind, low: boolean, targetName: string): string {
  const verb = h.type === 'create' ? 'creates' : h.type === 'call' ? 'calls' : h.type === 'override' ? 'is overridden by' : h.type;
  const parts = [`${verb} ${targetName} at ${h.ref.file}:${h.ref.line}${h.count > 1 ? ` (${h.count} call sites)` : ''}.`];
  if (kind === 'unresolved') parts.push('The indexer could not tell which function this is.');
  else if (h.provenance === 'dispatch') parts.push('A possible target through an interface or override: which one runs depends on the object at runtime.');
  else if (kind === 'ambiguous') parts.push(`${h.candidates?.length ?? 'Several'} possible targets: which one runs depends on the object at runtime.`);
  if (h.provenance === 'source_scan') parts.push(`Found by reading the source text of an inline handler, not from an indexed relation (${Math.round(h.confidence * 100)}% sure).`);
  else if (low && kind !== 'unresolved') parts.push(`Lower confidence (${Math.round(h.confidence * 100)}%).`);
  if (h.link === 'cycle') parts.push('Back to a function already on this path (a cycle): not expanded again.');
  else if (h.link === 'seen') parts.push('This function is already in the picture (see above): not expanded again.');
  return parts.join(' ');
}

function cardOf(n: FlowNode, trace: FlowTrace, columnOf: (depth: number) => number): FlowCard {
  const root = n.depth === 0;
  const detail = !root ? undefined : trace.root.span ? `inline handler, lines ${trace.root.span.line_start}–${trace.root.span.line_end}` : n.kind === 'file' ? 'module scope' : undefined;
  return {
    id: n.id, entityId: n.id, kind: n.kind, name: displayName(n), file: n.file, line: n.line,
    role: root ? 'root' : trace.direction === 'in' && n.entry_kind ? 'trigger' : 'step',
    depth: n.depth, column: columnOf(n.depth), seq: n.order, step: 0, laneId: n.lane_id, parentId: null,
    ...(n.entry_kind ? { entryKind: n.entry_kind } : {}),
    ...(root ? { entryLabel: trace.root.label } : {}),
    ...(detail ? { detail } : {}),
    candidates: [],
  };
}

function candidatesOf(h: FlowHop, inTrace: Map<string, FlowNode>, ctx: FlowModelContext): FlowCandidate[] {
  return (h.candidates ?? []).map((id) => {
    const n = inTrace.get(id);
    if (n) return { id, name: displayName(n), where: `${n.file}:${n.line}`, inTrace: true };
    const e = ctx.entity?.(id);
    return { id, name: e?.name ?? id, where: e ? `${e.file}:${e.line}` : '', inTrace: false };
  });
}

export function buildFlowModel(trace: FlowTrace, ctx: FlowModelContext = {}): FlowModel {
  const dir = trace.direction;
  const nodeById = new Map(trace.nodes.map((n) => [n.id, n]));
  const maxDepth = trace.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const columnOf = (depth: number): number => (dir === 'out' ? depth : maxDepth - depth);
  const cards = new Map<string, FlowCard>(trace.nodes.map((n) => [n.id, cardOf(n, trace, columnOf)]));
  const rootId = trace.root.entity_id;

  const edges: FlowEdge[] = [];
  const reached = new Set<string>([rootId]);
  let seq = 0;
  trace.hops.forEach((h, i) => {
    const step = i + 1;
    const near = cards.get(dir === 'out' ? h.from : h.to);
    const farId = dir === 'out' ? h.to : h.from;
    let far = farId === '' ? undefined : cards.get(farId);
    if (!far) {
      // A call the graph could not resolve (or an ambiguous name with no single target): a leaf card.
      const candidates = candidatesOf(h, nodeById, ctx);
      far = {
        id: leafId(i), entityId: null, kind: '', name: `?? ${h.target_name ?? '?'}`, file: h.ref.file, line: h.ref.line,
        role: h.resolution === 'ambiguous' && candidates.length > 0 ? 'candidates' : 'unresolved',
        depth: h.depth, column: near ? near.column + (dir === 'out' ? 1 : -1) : columnOf(h.depth), seq: ++seq, step,
        laneId: near?.laneId ?? '', parentId: near?.id ?? null, candidates,
      };
      cards.set(far.id, far);
      reached.add(far.id);
    } else if (h.link === 'new' && !reached.has(far.id)) {
      reached.add(far.id);
      far.seq = ++seq;
      far.step = step;
      far.parentId = near?.id ?? null;
    }
    if (h.resolution === 'ambiguous' && h.candidates?.length && far.candidates.length === 0) far.candidates = candidatesOf(h, nodeById, ctx);
    const kind = edgeKind(h);
    const low = h.provenance === 'source_scan' || h.confidence < LOW_CONFIDENCE;
    edges.push({
      id: `hop:${i}`, step, from: dir === 'out' ? h.from : far.id, to: dir === 'out' ? far.id : h.to,
      type: h.type, ref: h.ref, label: refLabel(h.ref.file, h.ref.line, h.count), count: h.count, kind, link: h.link,
      provenance: h.provenance, resolution: h.resolution, confidence: h.confidence, lowConfidence: low, back: false,
      tree: far.step === step, explain: describeEdge(h, kind, low, far.name.replace(/^\?\? /, '')),
    });
  });

  // Cards no hop reached (a root without calls, or inconsistent input) keep the trace's own order, after the rest.
  for (const c of cards.values()) if (!reached.has(c.id)) c.seq = seq + 1 + c.seq;
  for (const e of edges) e.back = (cards.get(e.to)?.column ?? 0) <= (cards.get(e.from)?.column ?? 0);

  const list = [...cards.values()];
  const model: FlowModel = {
    direction: dir, rootId, cards: list, edges, lanes: lanesOf(trace, list, ctx),
    columns: list.reduce((m, c) => Math.max(m, c.column), 0) + 1,
    notices: flowNotices(trace, edges), notes: trace.notes,
    stats: {
      nodes: trace.stats.nodes, hops: trace.stats.hops, unresolved: trace.stats.unresolved, ambiguous: trace.stats.ambiguous,
      dropped: trace.stats.dropped, depthReached: trace.stats.depth_reached,
    },
    key: '',
  };
  model.key = modelKey(model);
  return model;
}

function lanesOf(trace: FlowTrace, cards: FlowCard[], ctx: FlowModelContext): FlowLaneModel[] {
  const used = trace.lanes.filter((l) => cards.some((c) => c.laneId === l.id));
  const fixed = used.map((l) => ctx.laneColor?.({ id: l.id, path: l.path, kind: l.kind }));
  const colours = assignColors(used.map((l, i) => ({ key: l.path || l.id, ...(fixed[i] !== undefined ? { fixed: fixed[i] } : {}) })));
  const lanes: FlowLaneModel[] = used.map((l, i) => ({
    id: l.id, label: l.label, kind: l.kind, path: l.path, colorIndex: colours[i],
    cardIds: cards.filter((c) => c.laneId === l.id).map((c) => c.id),
  }));
  // A card in no lane (should not happen) gets a lane of its own rather than vanishing.
  const orphans = cards.filter((c) => !lanes.some((l) => l.id === c.laneId));
  if (orphans.length > 0) {
    for (const c of orphans) c.laneId = 'flow:other';
    lanes.push({ id: 'flow:other', label: 'other', kind: 'folder', path: '', colorIndex: 5, cardIds: orphans.map((c) => c.id) });
  }
  return lanes;
}

/** Identity of everything the picture depends on, so the layout is recomputed exactly when it must be. */
function modelKey(m: FlowModel): string {
  const cards = m.cards.map((c) => `${c.id}@${c.column}/${c.laneId}/${c.seq}/${c.role}/${c.name}`).join(';');
  const edges = m.edges.map((e) => `${e.from}>${e.to}:${e.kind}${e.back ? 'b' : ''}${e.lowConfidence ? 'l' : ''}${e.label}`).join(';');
  const lanes = m.lanes.map((l) => `${l.id}:${l.colorIndex}:${l.label}`).join(';');
  return `${m.direction}:${m.cards.length}:${m.edges.length}:${hashKey(`${cards}|${edges}|${lanes}`).toString(36)}`;
}
