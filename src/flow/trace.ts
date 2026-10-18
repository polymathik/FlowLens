/**
 * traceFlow — "what happens when X runs?" (and, reversed, "what triggers X?").
 *
 * Breadth-first from the root decides WHICH nodes are in the trace (shortest
 * distance first, so `max_nodes` keeps the nearest ones); a depth-first walk
 * over that tree then orders the hops in CALL ORDER (siblings by reference
 * line). Cycles are cut (a hop back to an ancestor is kept, flagged `cycle`,
 * never expanded again), repeated call sites arrive already folded by the
 * graph (`count`), and calls the indexer could not resolve become leaf hops.
 *
 * ```mermaid
 * flowchart LR
 *   R[root entity + span] --> E{expand}
 *   E --> G[graph call/create edges]
 *   E --> U[unresolved keyspace]
 *   E --> D[interface / override dispatch]
 *   E --> S[module-scope source scan]
 *   G & U & D & S --> B[BFS: depth, max_nodes] --> O[DFS: call order, link kind] --> L[lanes]
 * ```
 */
import type { Entity } from '../contracts/entities.js';
import type { PackageInfo } from '../contracts/hierarchy.js';
import {
  DEFAULT_FOLLOW, FLOW_LIMITS,
  type EntryPoint, type FlowDirection, type FlowFollowType, type FlowHop, type FlowNode, type FlowTrace,
} from '../contracts/flow.js';
import { expandIn, expandOut, scanIndex, type Candidate, type ExpandContext } from './expand.js';
import type { FlowGraph } from './graph.js';
import { buildLanes } from './lanes.js';
import { callsInSpan } from './span-calls.js';
import type { SourceProvider } from './source.js';

export interface TraceOptions {
  depth?: number;
  follow?: readonly FlowFollowType[];
  maxNodes?: number;
  includeTests?: boolean;
  direction?: FlowDirection;
  /** Reads source text; enables the module-scope scan. */
  source?: SourceProvider;
  /** Detected entry points: annotate nodes and, for `in`, end the walk at them. */
  entries?: EntryPoint[];
  packages?: PackageInfo[];
  projectName?: string;
}

export class FlowTraceError extends Error {
  constructor(readonly code: 'not_found', message: string) {
    super(message);
  }
}

/** An entry point for an arbitrary entity ("trace from here"). */
export function entryForEntity(e: Entity): EntryPoint {
  return {
    entity_id: e.id, qualified_name: e.qualified_name, file: e.file, line: e.location.line_start, kind: 'unknown',
    label: e.name, confidence: 1, evidence: 'traced on request',
  };
}

interface NodeState {
  entity: Entity;
  depth: number;
  parent: string | null;
  cands: Candidate[];
  expanded: boolean;
}

const clampInt = (v: number | undefined, def: number, cap: number): number =>
  Math.max(1, Math.min(Number.isFinite(v) ? Math.floor(v as number) : def, cap));

export function traceFlow(graph: FlowGraph, from: EntryPoint | string, opts: TraceOptions = {}): FlowTrace {
  const root = typeof from === 'string' ? graph.byId.get(from) : graph.byId.get(from.entity_id);
  if (!root) throw new FlowTraceError('not_found', `Unknown entity: ${typeof from === 'string' ? from : from.entity_id}`);
  const entry = typeof from === 'string' ? entryForEntity(root) : from;
  const direction = opts.direction ?? 'out';
  const maxDepth = clampInt(opts.depth, FLOW_LIMITS.depth.default, FLOW_LIMITS.depth.cap);
  const maxNodes = clampInt(opts.maxNodes, FLOW_LIMITS.maxNodes.default, FLOW_LIMITS.maxNodes.cap);
  const entries = opts.entries ?? [];
  const entryByEntity = new Map<string, EntryPoint[]>();
  for (const e of entries) entryByEntity.set(e.entity_id, [...(entryByEntity.get(e.entity_id) ?? []), e]);
  const plainEntry = (id: string): EntryPoint | undefined => entryByEntity.get(id)?.find((e) => !e.span && e.kind !== 'test' && e.kind !== 'unknown');

  const ctx: ExpandContext = {
    graph, follow: new Set(opts.follow ?? DEFAULT_FOLLOW), includeTests: (opts.includeTests ?? false) || graph.isTestFile(root.file),
    source: opts.source, rootSpan: entry.span, rootId: root.id,
  };

  if (direction === 'in') ctx.scanCallers = scanIndex(ctx, entries);

  const states = new Map<string, NodeState>([[root.id, { entity: root, depth: 0, parent: null, cands: [], expanded: false }]]);
  const queue: string[] = [root.id];
  const triggers = new Map<string, { entry: EntryPoint; depth: number }>();
  let dropped = 0;
  const droppedIds = new Set<string>();

  for (let i = 0; i < queue.length; i++) {
    const s = states.get(queue[i]) as NodeState;
    // An `in` walk records every entry point it passes but keeps going: the same function can be reached from several flows.
    const reached = direction === 'in' && s.entity.id !== root.id ? plainEntry(s.entity.id) : undefined;
    if (reached) triggers.set(reached.label + reached.entity_id, { entry: reached, depth: s.depth });
    if (s.depth >= maxDepth) continue;
    s.expanded = true;
    const cands = (direction === 'out' ? expandOut(ctx, s.entity) : expandIn(ctx, s.entity));
    cands.sort((a, b) => a.ref.line - b.ref.line || a.col - b.col || a.type.localeCompare(b.type) || a.relation_id.localeCompare(b.relation_id));
    for (const c of cands) {
      for (const e of c.entries ?? []) {
        const k = e.label + e.entity_id;
        const prev = triggers.get(k);
        if (!prev || prev.depth > s.depth + 1) triggers.set(k, { entry: e, depth: s.depth + 1 });
      }
      if (c.far !== '' && !states.has(c.far)) {
        if (states.size >= maxNodes) {
          if (!droppedIds.has(c.far)) { droppedIds.add(c.far); dropped++; }
          continue;
        }
        states.set(c.far, { entity: graph.byId.get(c.far) as Entity, depth: s.depth + 1, parent: s.entity.id, cands: [], expanded: false });
        queue.push(c.far);
      }
      s.cands.push(c);
    }
  }
  if (direction === 'in') collectSpanTriggers(ctx, states, entries, triggers);

  return assemble({ graph, root, entry, direction, states, dropped, maxNodes, opts, entries, triggers, plainEntry, ctx });
}

/**
 * `in`: a caller inside an inline handler's span is triggered by that entry.
 * The recorded call site of an aggregated edge is only its first one, so a call
 * elsewhere in the span is looked up in the source.
 */
function collectSpanTriggers(ctx: ExpandContext, states: Map<string, NodeState>, entries: EntryPoint[], out: Map<string, { entry: EntryPoint; depth: number }>): void {
  for (const e of entries) {
    if (!e.span || e.kind === 'test') continue;
    const span = e.span;
    const text = ctx.source?.(e.file);
    const hit = (c: Candidate): boolean => {
      if (c.from !== e.entity_id) return false;
      if (c.ref.file === e.file && c.ref.line >= span.line_start && c.ref.line <= span.line_end) return true;
      const callee = c.provenance === 'graph' && (c.type === 'call' || c.type === 'create') ? ctx.graph.byId.get(c.to) : undefined;
      return !!callee && text !== undefined && callsInSpan(text, callee.name, span.line_start, span.line_end) !== null;
    };
    for (const s of states.values()) {
      if (!s.cands.some(hit)) continue;
      const k = e.label + e.entity_id;
      const prev = out.get(k);
      if (!prev || prev.depth > s.depth + 1) out.set(k, { entry: e, depth: s.depth + 1 });
    }
  }
}

interface AssembleInput {
  graph: FlowGraph;
  root: Entity;
  entry: EntryPoint;
  direction: FlowDirection;
  states: Map<string, NodeState>;
  dropped: number;
  maxNodes: number;
  opts: TraceOptions;
  entries: EntryPoint[];
  triggers: Map<string, { entry: EntryPoint; depth: number }>;
  plainEntry: (id: string) => EntryPoint | undefined;
  ctx: ExpandContext;
}

function assemble(a: AssembleInput): FlowTrace {
  const { states, direction, root } = a;
  const hops: FlowHop[] = [];
  const order: string[] = [];
  const path = new Set<string>();
  const placed = new Set<string>();

  const visit = (id: string): void => {
    const s = states.get(id) as NodeState;
    order.push(id);
    path.add(id);
    const discovered = new Set<string>();
    for (const c of s.cands) {
      let link: FlowHop['link'] = 'new';
      if (c.far !== '') {
        if (path.has(c.far)) link = 'cycle';
        else if (placed.has(c.far) || discovered.has(c.far) || states.get(c.far)?.parent !== id) link = 'seen';
        else discovered.add(c.far);
      }
      hops.push(toHop(c, s.depth + 1, link));
      if (link === 'new' && c.far !== '') {
        placed.add(c.far);
        visit(c.far);
      }
    }
    path.delete(id);
  };
  visit(root.id);

  const nodesInOrder = order.map((id) => states.get(id) as NodeState);
  const { lanes, laneOf } = buildLanes(a.graph, nodesInOrder.map((s) => s.entity), a.opts.packages, a.opts.projectName);
  const nodes: FlowNode[] = nodesInOrder.map((s, i) => {
    const plain = i === 0 ? undefined : a.plainEntry(s.entity.id);
    return {
      id: s.entity.id, kind: s.entity.kind, name: s.entity.name, qualified_name: s.entity.qualified_name, file: s.entity.file,
      line: s.entity.location.line_start, depth: s.depth, order: i, lane_id: laneOf.get(s.entity.id) as string,
      ...(plain ? { entry_kind: plain.kind } : {}),
    };
  });
  const unresolved = hops.filter((h) => h.resolution === 'unresolved').length;
  const ambiguous = hops.filter((h) => h.resolution === 'ambiguous').length;
  const triggers = [...a.triggers.values()].sort((x, y) => x.depth - y.depth || x.entry.label.localeCompare(y.entry.label)).map((t) => t.entry);
  return {
    root: a.entry, direction, hops, nodes, truncated: a.dropped > 0, triggers,
    stats: { depth_reached: Math.max(0, ...nodes.map((n) => n.depth)), nodes: nodes.length, hops: hops.length, unresolved, ambiguous, dropped: a.dropped },
    lanes, notes: notesFor(a, nodes.length, unresolved, hops),
  };
}

function toHop(c: Candidate, depth: number, link: FlowHop['link']): FlowHop {
  return {
    from: c.from, to: c.to, relation_id: c.relation_id, type: c.type, depth, ref: c.ref, resolution: c.resolution,
    confidence: Math.round(c.confidence * 100) / 100, count: c.count, link, provenance: c.provenance,
    ...(c.candidates ? { candidates: c.candidates } : {}), ...(c.target_name ? { target_name: c.target_name } : {}),
  };
}

function notesFor(a: AssembleInput, nodeCount: number, unresolved: number, hops: FlowHop[]): string[] {
  const notes: string[] = [];
  const { entry, root, direction } = a;
  if (direction === 'out' && root.kind === 'file') notes.push('Rooted at a file: calls at module scope were read from the source text (the indexer attributes no relations to them).');
  if (hops.some((h) => h.provenance === 'source_scan')) notes.push('Hops marked source_scan come from scanning source text, not from indexed relations: direct calls only (obj.method() receivers are not resolved).');
  if (a.dropped > 0) notes.push(`${a.dropped} more reachable node(s) were left out (max_nodes ${a.maxNodes}); raise max_nodes or lower depth.`);
  if (unresolved > 0) notes.push(`${unresolved} call(s) could not be resolved to an entity and are shown as leaves.`);
  if (nodeCount === 1 && hops.length === 0) {
    notes.push(direction === 'out'
      ? 'No calls found from here. The indexer does not follow obj.method() through instance receivers, JSX children or template event bindings, so flows through those are invisible.'
      : 'No callers found. Callers through instance receivers or inside module-scope callbacks are not in the graph.');
  }
  if (entry.span && root.kind !== 'file') notes.push(`Restricted to the inline handler at lines ${entry.span.line_start}-${entry.span.line_end} of ${root.file}.`);
  if (direction === 'in' && a.triggers.size === 0) notes.push('No entry point reached within the depth limit.');
  return notes;
}
