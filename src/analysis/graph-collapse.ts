/**
 * Graph collapsing utilities for cycle detection at different granularities.
 *
 * Converts raw entity/relation graphs into simplified adjacency lists
 * grouped by file, module, function, or raw entity level.
 */

import type { Entity } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import type { CycleGranularity } from '../contracts/analysis/cycles.js';

export interface CollapsedGraph {
  adjacency: Map<string, Set<string>>;
  relationTypes: Map<string, Set<RelationType>>;
}

/**
 * Build a collapsed adjacency list from entities and edges.
 *
 * - `file`: one node per file path, edges between files
 * - `module`: one node per top-level directory (first segment of file path)
 * - `function`: only function/method entities with `call` edges
 * - `all`: raw entity graph
 */
export function collapseGraph(
  entities: Entity[],
  edges: Relation[],
  granularity: CycleGranularity,
  relationTypeFilter?: RelationType[],
): CollapsedGraph {
  const filteredEdges = filterEdges(edges, granularity, relationTypeFilter);

  switch (granularity) {
    case 'file':
      return collapseByFile(entities, filteredEdges);
    case 'module':
      return collapseByModule(entities, filteredEdges);
    case 'function':
      return collapseByFunction(entities, filteredEdges);
    case 'all':
      return collapseAll(entities, filteredEdges);
  }
}

function filterEdges(
  edges: Relation[],
  granularity: CycleGranularity,
  relationTypeFilter?: RelationType[],
): Relation[] {
  let filtered = edges;

  if (granularity === 'function') {
    filtered = filtered.filter((e) => e.type === 'call');
  } else if (relationTypeFilter && relationTypeFilter.length > 0) {
    const typeSet = new Set(relationTypeFilter);
    filtered = filtered.filter((e) => typeSet.has(e.type));
  }

  return filtered;
}

function collapseByFile(entities: Entity[], edges: Relation[]): CollapsedGraph {
  const entityToFile = new Map<string, string>();
  for (const e of entities) {
    entityToFile.set(e.id, e.file);
  }

  const adjacency = new Map<string, Set<string>>();
  const relationTypes = new Map<string, Set<RelationType>>();

  // Ensure all files appear as nodes
  for (const file of new Set(entityToFile.values())) {
    if (!adjacency.has(file)) adjacency.set(file, new Set());
  }

  for (const edge of edges) {
    const fromFile = entityToFile.get(edge.from);
    const toFile = entityToFile.get(edge.to);
    if (!fromFile || !toFile || fromFile === toFile) continue;

    if (!adjacency.has(fromFile)) adjacency.set(fromFile, new Set());
    adjacency.get(fromFile)!.add(toFile);

    const key = `${fromFile}->${toFile}`;
    if (!relationTypes.has(key)) relationTypes.set(key, new Set());
    relationTypes.get(key)!.add(edge.type);
  }

  return { adjacency, relationTypes };
}

function collapseByModule(entities: Entity[], edges: Relation[]): CollapsedGraph {
  const entityToModule = new Map<string, string>();
  for (const e of entities) {
    entityToModule.set(e.id, extractModule(e.file));
  }

  const adjacency = new Map<string, Set<string>>();
  const relationTypes = new Map<string, Set<RelationType>>();

  // Ensure all modules appear as nodes
  for (const mod of new Set(entityToModule.values())) {
    if (!adjacency.has(mod)) adjacency.set(mod, new Set());
  }

  for (const edge of edges) {
    const fromMod = entityToModule.get(edge.from);
    const toMod = entityToModule.get(edge.to);
    if (!fromMod || !toMod || fromMod === toMod) continue;

    if (!adjacency.has(fromMod)) adjacency.set(fromMod, new Set());
    adjacency.get(fromMod)!.add(toMod);

    const key = `${fromMod}->${toMod}`;
    if (!relationTypes.has(key)) relationTypes.set(key, new Set());
    relationTypes.get(key)!.add(edge.type);
  }

  return { adjacency, relationTypes };
}

function collapseByFunction(entities: Entity[], edges: Relation[]): CollapsedGraph {
  const funcKinds = new Set(['function', 'method']);
  const funcIds = new Set(entities.filter((e) => funcKinds.has(e.kind)).map((e) => e.id));

  const adjacency = new Map<string, Set<string>>();
  const relationTypes = new Map<string, Set<RelationType>>();

  // Only function/method entities
  for (const id of funcIds) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  }

  for (const edge of edges) {
    if (!funcIds.has(edge.from) || !funcIds.has(edge.to)) continue;
    if (edge.from === edge.to) continue;

    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from)!.add(edge.to);

    const key = `${edge.from}->${edge.to}`;
    if (!relationTypes.has(key)) relationTypes.set(key, new Set());
    relationTypes.get(key)!.add(edge.type);
  }

  return { adjacency, relationTypes };
}

function collapseAll(entities: Entity[], edges: Relation[]): CollapsedGraph {
  const entityIds = new Set(entities.map((e) => e.id));
  const adjacency = new Map<string, Set<string>>();
  const relationTypes = new Map<string, Set<RelationType>>();

  for (const id of entityIds) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  }

  for (const edge of edges) {
    if (edge.from === edge.to) continue;

    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from)!.add(edge.to);

    const key = `${edge.from}->${edge.to}`;
    if (!relationTypes.has(key)) relationTypes.set(key, new Set());
    relationTypes.get(key)!.add(edge.type);
  }

  return { adjacency, relationTypes };
}

/** Extract module name: first directory segment in the file path. */
function extractModule(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts[0] : filePath;
}
