/**
 * Cycle detection using Tarjan's Strongly Connected Components algorithm.
 *
 * Supports detection at file, module (directory), function (call graph) and
 * raw entity granularity. Each cycle carries an ordered closed `path` with
 * its edge sequence, scope filtering, and an explained severity based on
 * architecture layers, module spread and PageRank/dependent criticality.
 */

import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import type {
  DetectedCycle,
  CycleGranularity,
  CycleSeverity,
} from '../contracts/analysis/cycles.js';
import { hashContent } from '../utils/hash.js';
import { findStronglyConnectedComponents } from './tarjan.js';
import { collapseGraph, type CollapsedGraph } from './graph-collapse.js';
import { assessCycleSeverity } from './cycle-severity.js';
import { shortestCycleThrough } from './cycle-path.js';
import { computePageRankOnAdjacency } from './pagerank.js';
import { buildLayerMap } from './architecture-validator.js';
import { isInScope, moduleOfEntity, moduleOfFile } from './module-path.js';

export interface CycleDetectorOptions {
  granularity: CycleGranularity;
  /** Keep only cycles with at least one member under this path prefix. */
  scope?: string;
  relation_types?: RelationType[];
  severity_threshold?: CycleSeverity;
  /** Architecture config for layer-aware severity (optional). */
  architecture?: ArchitectureConfig | null;
  /** Precomputed entity id -> layer assignment for `architecture`. */
  layerMap?: Map<string, string | null>;
}

export const SEVERITY_ORDER: Record<CycleSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export async function detectCycles(
  graph: GraphStore,
  options: CycleDetectorOptions,
): Promise<DetectedCycle[]> {
  const [allEntities, allEdges] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  return detectCyclesInData(allEntities, allEdges, options);
}

/** Pure variant over already-loaded entities/edges (used with the MCP graph cache). */
export function detectCyclesInData(
  allEntities: Entity[],
  allEdges: Relation[],
  options: CycleDetectorOptions,
): DetectedCycle[] {
  const { granularity, relation_types, severity_threshold, scope } = options;
  const collapsed = collapseGraph(allEntities, allEdges, granularity, relation_types);
  const sccs = findStronglyConnectedComponents(collapsed.adjacency);
  if (sccs.length === 0) return [];

  const ctx = buildContext(allEntities, collapsed, options, sccs);
  const cycles: DetectedCycle[] = [];

  for (const scc of sccs) {
    const members = new Set(scc);
    const memberPaths = scc.map((n) => ctx.pathOf(n));
    if (!memberPaths.some((p) => isInScope(p, scope))) continue;
    cycles.push(buildCycle(scc, members, granularity, collapsed, ctx));
  }

  const filtered = severity_threshold
    ? cycles.filter((c) => SEVERITY_ORDER[c.severity] >= SEVERITY_ORDER[severity_threshold])
    : cycles;

  return filtered.sort((a, b) =>
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    || a.length - b.length
    || a.id.localeCompare(b.id));
}

interface DetectionContext {
  /** Repo path used for scope tests (file/module path, or the entity's file). */
  pathOf(node: string): string;
  label(node: string): string;
  moduleOf(node: string): string;
  layersOf(node: string): string[];
  entitiesOf(node: string): Entity[];
  pageRankRatio(node: string): number;
  reverse: Map<string, Set<string>>;
}

function buildContext(
  entities: Entity[],
  collapsed: CollapsedGraph,
  options: CycleDetectorOptions,
  sccs: string[][],
): DetectionContext {
  const g = options.granularity;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const layerMap = options.architecture
    ? options.layerMap ?? buildLayerMap(entities, options.architecture)
    : null;

  // Group entities by collapsed node for file/module granularity.
  const groups = new Map<string, Entity[]>();
  if (g === 'file' || g === 'module') {
    for (const e of entities) {
      const key = g === 'file' ? e.file : moduleOfEntity(e);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  }
  const entitiesOf = (n: string): Entity[] =>
    g === 'file' || g === 'module' ? groups.get(n) ?? [] : byId.has(n) ? [byId.get(n)!] : [];

  const reverse = new Map<string, Set<string>>();
  for (const [from, tos] of collapsed.adjacency) {
    for (const to of tos) {
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to)!.add(from);
    }
  }

  let ranks: Map<string, number> | null = null;
  const nodeCount = collapsed.adjacency.size;

  return {
    pathOf: (n) => (g === 'file' || g === 'module' ? n : byId.get(n)?.file ?? n),
    label: (n) => (g === 'file' || g === 'module' ? n : byId.get(n)?.qualified_name ?? n),
    moduleOf: (n) =>
      g === 'module' ? n : g === 'file' ? moduleOfFile(n) : byId.has(n) ? moduleOfEntity(byId.get(n)!) : n,
    layersOf: (n) => {
      if (!layerMap) return [];
      const layers = new Set<string>();
      for (const e of entitiesOf(n)) {
        const l = layerMap.get(e.id);
        if (l) layers.add(l);
      }
      return [...layers];
    },
    entitiesOf,
    pageRankRatio: (n) => {
      ranks ??= computePageRankOnAdjacency(withoutIntraCycleEdges(collapsed.adjacency, sccs));
      return (ranks.get(n) ?? 0) * nodeCount;
    },
    reverse,
  };
}

/**
 * PageRank input without edges inside a cycle: a strongly connected component
 * otherwise traps rank and every cycle member looks "central". With them
 * removed, a member's rank reflects how much the rest of the graph depends on it.
 */
function withoutIntraCycleEdges(
  adjacency: Map<string, Set<string>>,
  sccs: string[][],
): Map<string, Set<string>> {
  const sccOf = new Map<string, number>();
  sccs.forEach((scc, i) => scc.forEach((n) => sccOf.set(n, i)));
  const out = new Map<string, Set<string>>();
  for (const [from, tos] of adjacency) {
    const s = sccOf.get(from);
    out.set(from, new Set([...tos].filter((to) => s === undefined || sccOf.get(to) !== s)));
  }
  return out;
}

function buildCycle(
  scc: string[],
  members: Set<string>,
  granularity: CycleGranularity,
  collapsed: CollapsedGraph,
  ctx: DetectionContext,
): DetectedCycle {
  const sorted = [...scc].sort();
  const path = shortestCycleThrough(sorted[0], members, collapsed.adjacency);
  const onPath = new Set(path);
  const entities = [...path.slice(0, -1), ...sorted.filter((m) => !onPath.has(m))];

  const edges = [];
  for (let i = 0; i < path.length - 1; i++) {
    const types = collapsed.relationTypes.get(`${path[i]}->${path[i + 1]}`);
    edges.push({ from: path[i], to: path[i + 1], relation_types: [...(types ?? [])].sort() });
  }

  const layers = new Set<string>();
  const modules = new Set<string>();
  const external = new Set<string>();
  let maxRatio = 0;
  let caSum = 0;
  let caCount = 0;
  for (const m of scc) {
    for (const l of ctx.layersOf(m)) layers.add(l);
    modules.add(ctx.moduleOf(m));
    for (const src of ctx.reverse.get(m) ?? []) if (!members.has(src)) external.add(src);
    maxRatio = Math.max(maxRatio, ctx.pageRankRatio(m));
    for (const e of ctx.entitiesOf(m)) {
      if (e.metrics?.afferent_coupling !== undefined) {
        caSum += e.metrics.afferent_coupling;
        caCount++;
      }
    }
  }

  const { severity, reasons } = assessCycleSeverity({
    layers: [...layers].sort(),
    moduleCount: modules.size,
    maxPageRankRatio: maxRatio,
    externalDependents: external.size,
    avgAfferentCoupling: caCount > 0 ? caSum / caCount : 0,
  });

  return {
    id: hashContent(sorted.join(':')),
    entities,
    granularity,
    severity,
    relation_types: collectCycleRelationTypes(members, collapsed),
    length: scc.length,
    path,
    path_labels: path.map((n) => ctx.label(n)),
    edges,
    severity_reasons: reasons,
    layers: [...layers].sort(),
  };
}

/** All unique relation types on edges between cycle members. */
function collectCycleRelationTypes(
  members: Set<string>,
  collapsed: CollapsedGraph,
): RelationType[] {
  const types = new Set<RelationType>();
  for (const from of members) {
    for (const to of collapsed.adjacency.get(from) ?? []) {
      if (!members.has(to)) continue;
      for (const t of collapsed.relationTypes.get(`${from}->${to}`) ?? []) types.add(t);
    }
  }
  return [...types].sort();
}
