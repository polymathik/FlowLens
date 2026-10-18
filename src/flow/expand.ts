/**
 * One step of a trace: the hops leaving (or entering) a node.
 *
 * Sources, in order of trust: graph relations (`call` / `create` / …),
 * the unresolved-relation keyspace (dashed leaves), dispatch through
 * interface / override edges, and — for module-scope code only — calls read
 * from source (`inline-seeds.ts`).
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { EntryPoint, FlowFollowType, FlowHop } from '../contracts/flow.js';
import { FLOW_LIMITS } from '../contracts/flow.js';
import type { FlowGraph } from './graph.js';
import { scanSeedCalls } from './inline-seeds.js';
import type { SourceProvider } from './source.js';

/** A hop before it is placed in the trace. `far` is the node the BFS adds (callee for `out`, caller for `in`). */
export interface Candidate {
  /** Node id to add ('' for unresolved leaves). */
  far: string;
  from: string;
  to: string;
  relation_id: string;
  type: FlowHop['type'];
  ref: { file: string; line: number };
  col: number;
  resolution: FlowHop['resolution'];
  confidence: number;
  candidates?: string[];
  target_name?: string;
  count: number;
  provenance: FlowHop['provenance'];
  /** `in` traces: the module-scope entry points this source-scanned caller stands for. */
  entries?: EntryPoint[];
}

export interface ExpandContext {
  graph: FlowGraph;
  follow: ReadonlySet<FlowFollowType>;
  includeTests: boolean;
  source?: SourceProvider;
  /** The root's handler span (applies to the root node only). */
  rootSpan?: EntryPoint['span'];
  rootId: string;
  /** `in` traces: source-scanned calls made by module-scope entries, by callee id (see `scanIndex`). */
  scanCallers?: ReadonlyMap<string, Candidate[]>;
}

const SKIP_TARGETS = new Set(['parameter', 'decorator', 'enum_member', 'file', 'module']);

const inSpan = (line: number, span: EntryPoint['span']): boolean => !span || (line >= span.line_start && line <= span.line_end);

/** Entities whose relations stand for `e`: a class also runs its constructor. */
function actors(graph: FlowGraph, e: Entity): Entity[] {
  if (e.kind !== 'class') return [e];
  const ctor = graph.member(e, 'constructor') ?? graph.member(e, '__init__');
  return ctor ? [e, ctor] : [e];
}

function allowed(ctx: ExpandContext, e: Entity | undefined): e is Entity {
  return !!e && !SKIP_TARGETS.has(e.kind) && (ctx.includeTests || !ctx.graph.isTestFile(e.file));
}

/** Implementations/overrides a call to `target` may actually run (virtual dispatch). */
export function dispatchTargets(graph: FlowGraph, target: Entity): Entity[] {
  if (target.kind !== 'method') return [];
  return graph.memoize(`dispatch:${target.id}`, () => {
    const found = new Map<string, Entity>();
    for (const r of graph.edgesTo(target.id, 'override')) {
      const m = graph.byId.get(r.from);
      if (m) found.set(m.id, m);
    }
    const cls = graph.container(target);
    if (cls && cls.kind === 'interface') {
      for (const type of ['implement', 'extend']) {
        for (const r of graph.edgesTo(cls.id, type)) {
          const impl = graph.byId.get(r.from);
          const m = impl && graph.member(impl, target.name);
          if (m) found.set(m.id, m);
        }
      }
    }
    return [...found.values()].sort((a, b) => a.qualified_name.localeCompare(b.qualified_name)).slice(0, FLOW_LIMITS.dispatchCandidates);
  });
}

/** Methods that `m` overrides or implements (the reverse of `dispatchTargets`). */
function dispatchBases(graph: FlowGraph, m: Entity): Entity[] {
  if (m.kind !== 'method') return [];
  const found = new Map<string, Entity>();
  for (const r of graph.edgesFrom(m.id, 'override')) {
    const b = graph.byId.get(r.to);
    if (b) found.set(b.id, b);
  }
  const cls = graph.container(m);
  for (const type of ['implement', 'extend']) {
    for (const r of cls ? graph.edgesFrom(cls.id, type) : []) {
      const iface = graph.byId.get(r.to);
      const base = iface && graph.member(iface, m.name);
      if (base) found.set(base.id, base);
    }
  }
  return [...found.values()].sort((a, b) => a.qualified_name.localeCompare(b.qualified_name));
}

function graphCandidate(r: Relation, far: string, base: Pick<Candidate, 'provenance'>): Candidate {
  return {
    far, from: r.from, to: r.to, relation_id: r.id, type: r.type as FlowHop['type'],
    ref: { file: r.location.file, line: r.location.line }, col: r.location.column,
    resolution: 'resolved', confidence: r.confidence, count: Math.max(1, r.weight), provenance: base.provenance,
  };
}

/** Hops from `n` to what it runs. */
export function expandOut(ctx: ExpandContext, n: Entity): Candidate[] {
  const { graph } = ctx;
  const span = n.id === ctx.rootId ? ctx.rootSpan : undefined;
  const out: Candidate[] = [];
  for (const actor of actors(graph, n)) {
    for (const r of graph.edgesFrom(actor.id)) {
      if (!ctx.follow.has(r.type as FlowFollowType) || !inSpan(r.location.line, span)) continue;
      const target = graph.byId.get(r.to);
      if (!allowed(ctx, target)) continue;
      const c = graphCandidate(r, target.id, { provenance: 'graph' });
      const via = dispatchTargets(graph, target);
      if (via.length > 0) {
        c.resolution = 'ambiguous';
        c.candidates = via.map((m) => m.id);
        c.confidence = Math.min(c.confidence, via.length === 1 ? 0.85 : 0.6);
      }
      out.push(c);
    }
    for (const r of graph.unresolvedFrom.get(actor.id) ?? []) {
      if (!ctx.follow.has(r.type as FlowFollowType) || !inSpan(r.location.line, span)) continue;
      const ambiguous = r.resolution === 'ambiguous';
      out.push({
        far: '', from: n.id, to: '', relation_id: r.id, type: r.type as FlowHop['type'],
        ref: { file: r.location.file, line: r.location.line }, col: r.location.column,
        resolution: ambiguous ? 'ambiguous' : 'unresolved', confidence: Math.min(r.confidence, ambiguous ? 0.4 : 0.3),
        target_name: r.target_name ?? '?', candidates: ambiguous ? r.meta?.candidates : undefined,
        count: Math.max(1, r.weight), provenance: 'graph',
      });
    }
  }
  if (n.kind === 'method') {
    for (const d of dispatchTargets(graph, n)) {
      const via = graph.edgesFrom(d.id, 'override').some((r) => r.to === n.id) ? 'override' : 'implement';
      out.push({
        far: d.id, from: n.id, to: d.id, relation_id: `dispatch:${n.id}:${d.id}`, type: via,
        ref: { file: d.file, line: d.location.line_start }, col: 0, resolution: 'ambiguous', confidence: 0.6, count: 1, provenance: 'dispatch',
      });
    }
  }
  if (n.kind === 'file') out.push(...seedCandidates(ctx, n, span)); // module-scope code is not attributed in the graph
  return out.filter((c) => c.far === '' || allowed(ctx, graph.byId.get(c.far)));
}

function seedCandidates(ctx: ExpandContext, n: Entity, span: EntryPoint['span']): Candidate[] {
  const text = ctx.source?.(n.file);
  if (text === undefined) return [];
  const seen = new Map<string, Candidate>();
  for (const call of scanSeedCalls(ctx.graph, n.file, text, span?.line_start, span?.line_end)) {
    const ids = call.matches.map((m) => m.id);
    const key = `${call.isNew}:${ids.join(',')}`;
    const hit = seen.get(key);
    if (hit) {
      hit.count++;
      continue;
    }
    const single = call.matches.length === 1;
    seen.set(key, {
      far: single ? ids[0] : '', from: n.id, to: single ? ids[0] : '', relation_id: `text:${n.file}:${call.line}:${call.name}`,
      type: call.isNew ? 'create' : 'call', ref: { file: n.file, line: call.line }, col: 0,
      resolution: single ? 'resolved' : 'ambiguous', confidence: single ? 0.6 : 0.35,
      ...(single ? {} : { candidates: ids, target_name: call.name }), count: 1, provenance: 'source_scan',
    });
  }
  return [...seen.values()];
}

/** Hops entering `n`: who calls/creates it (and which base methods it implements). */
export function expandIn(ctx: ExpandContext, n: Entity): Candidate[] {
  const { graph } = ctx;
  const out: Candidate[] = [];
  const targets = [n, ...(n.kind === 'method' && graph.container(n)?.kind === 'class' && n.name === 'constructor' ? [graph.container(n) as Entity] : [])];
  for (const target of targets) {
    for (const r of graph.edgesTo(target.id)) {
      if (!ctx.follow.has(r.type as FlowFollowType)) continue;
      const caller = graph.byId.get(r.from);
      if (!allowed(ctx, caller)) continue;
      out.push(graphCandidate({ ...r, to: n.id }, caller.id, { provenance: 'graph' }));
    }
  }
  out.push(...(ctx.scanCallers?.get(n.id) ?? []));
  for (const base of dispatchBases(graph, n)) {
    if (!allowed(ctx, base)) continue;
    out.push({
      far: base.id, from: base.id, to: n.id, relation_id: `dispatch:${base.id}:${n.id}`, type: graph.edgesFrom(n.id, 'override').some((r) => r.to === base.id) ? 'override' : 'implement',
      ref: { file: n.file, line: n.location.line_start }, col: 0, resolution: 'ambiguous', confidence: 0.6, count: 1, provenance: 'dispatch',
    });
  }
  return out;
}

/**
 * Calls made by module-scope entry points (file-rooted: the extractor attributes
 * none of them), indexed by callee, so `in` traces can find the entry behind them.
 */
export function scanIndex(ctx: ExpandContext, entries: EntryPoint[]): Map<string, Candidate[]> {
  const index = new Map<string, Candidate[]>();
  for (const e of entries) {
    const file = ctx.graph.byId.get(e.entity_id);
    if (!file || file.kind !== 'file' || e.kind === 'test' || e.kind === 'unknown' || !ctx.source) continue;
    for (const c of seedCandidates({ ...ctx, rootId: file.id, rootSpan: e.span }, file, e.span)) {
      if (c.far === '') continue;
      const list = index.get(c.far) ?? [];
      const same = list.find((x) => x.relation_id === c.relation_id);
      if (same) same.entries?.push(e);
      else list.push({ ...c, far: file.id, from: file.id, entries: [e] });
      index.set(c.far, list);
    }
  }
  return index;
}
