/**
 * Graph collapsing utilities for cycle detection at different granularities.
 *
 * Converts raw entity/relation graphs into simplified adjacency lists
 * grouped by file, module, function, or raw entity level.
 *
 * Phase 12: type-level edges (see `type-level.ts`) are dropped unless
 * `includeTypeOnly` is set; when they are kept, hops made only of type-level
 * relations are recorded in `typeOnlyHops`.
 */

import type { Entity } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import type { CycleGranularity } from '../contracts/analysis/cycles.js';
import { moduleOfEntity } from './module-path.js';
import { typeLevelPredicate } from './type-level.js';

export interface CollapsedGraph {
  adjacency: Map<string, Set<string>>;
  relationTypes: Map<string, Set<RelationType>>;
  /** `${from}->${to}` keys whose every underlying relation is type-level. */
  typeOnlyHops: Set<string>;
}

export interface CollapseOptions {
  /** Keep type-level edges (default false: runtime dependencies only). */
  includeTypeOnly?: boolean;
}

/**
 * Build a collapsed adjacency list from entities and edges.
 *
 * - `file`: one node per file path, edges between files
 * - `module`: one node per directory module (an entity's parent directory;
 *   `module` entities map to themselves) — see `module-path.ts`
 * - `function`: only function/method entities with `call` edges
 * - `all`: raw entity graph
 */
export function collapseGraph(
  entities: Entity[],
  edges: Relation[],
  granularity: CycleGranularity,
  relationTypeFilter?: RelationType[],
  options: CollapseOptions = {},
): CollapsedGraph {
  const isTypeLevel = typeLevelPredicate(entities);
  const filtered = filterEdges(edges, granularity, relationTypeFilter)
    .filter((e) => options.includeTypeOnly || !isTypeLevel(e));
  const nodeOf = nodeMapper(entities, granularity);
  const graph: CollapsedGraph = { adjacency: new Map(), relationTypes: new Map(), typeOnlyHops: new Set() };
  const runtimeHops = new Set<string>();

  for (const node of new Set(nodeOf.values())) graph.adjacency.set(node, new Set());

  for (const edge of filtered) {
    const from = nodeOf.get(edge.from);
    const to = nodeOf.get(edge.to);
    if (!from || !to || from === to) continue;
    graph.adjacency.get(from)!.add(to);
    const key = `${from}->${to}`;
    if (!graph.relationTypes.has(key)) graph.relationTypes.set(key, new Set());
    graph.relationTypes.get(key)!.add(edge.type);
    if (isTypeLevel(edge)) {
      if (!runtimeHops.has(key)) graph.typeOnlyHops.add(key);
    } else {
      runtimeHops.add(key);
      graph.typeOnlyHops.delete(key);
    }
  }
  return graph;
}

/** Entity id → collapsed node id for the granularity. */
function nodeMapper(entities: Entity[], granularity: CycleGranularity): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entities) {
    switch (granularity) {
      case 'file':
        map.set(e.id, e.file);
        break;
      case 'module':
        map.set(e.id, moduleOfEntity(e));
        break;
      case 'function':
        if (e.kind === 'function' || e.kind === 'method') map.set(e.id, e.id);
        break;
      case 'all':
        map.set(e.id, e.id);
        break;
    }
  }
  return map;
}

function filterEdges(
  edges: Relation[],
  granularity: CycleGranularity,
  relationTypeFilter?: RelationType[],
): Relation[] {
  if (granularity === 'function') return edges.filter((e) => e.type === 'call');
  if (relationTypeFilter && relationTypeFilter.length > 0) {
    const typeSet = new Set(relationTypeFilter);
    return edges.filter((e) => typeSet.has(e.type));
  }
  return edges;
}
