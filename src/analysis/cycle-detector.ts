/**
 * Cycle detection using Tarjan's Strongly Connected Components algorithm.
 *
 * Supports detection at file, module, function, and raw entity granularity.
 */

import type { GraphStore } from '../contracts/graph.js';
import type { RelationType } from '../contracts/relations.js';
import type {
  DetectedCycle,
  CycleGranularity,
  CycleSeverity,
} from '../contracts/analysis/cycles.js';
import { hashContent } from '../utils/hash.js';
import { findStronglyConnectedComponents } from './tarjan.js';
import { collapseGraph } from './graph-collapse.js';
import { computeCycleSeverity } from './cycle-severity.js';

export interface CycleDetectorOptions {
  granularity: CycleGranularity;
  scope?: string;
  relation_types?: RelationType[];
  severity_threshold?: CycleSeverity;
}

const SEVERITY_ORDER: Record<CycleSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export async function detectCycles(
  graph: GraphStore,
  options: CycleDetectorOptions,
): Promise<DetectedCycle[]> {
  const { granularity, relation_types, severity_threshold } = options;

  // Fetch all entities and edges from the graph
  const [allEntities, allEdges] = await Promise.all([
    graph.getAllNodes(),
    graph.getAllEdges(),
  ]);

  // Collapse the graph according to granularity
  const { adjacency, relationTypes } = collapseGraph(
    allEntities,
    allEdges,
    granularity,
    relation_types,
  );

  // Run Tarjan's SCC to find cycles
  const sccs = findStronglyConnectedComponents(adjacency);

  // Build a lookup for entity details (for severity computation)
  const entityMap = new Map(allEntities.map((e) => [e.id, e]));

  // Convert SCCs to DetectedCycle objects
  const cycles: DetectedCycle[] = sccs.map((scc) => {
    const sortedEntities = [...scc].sort();
    const id = hashContent(sortedEntities.join(':'));

    // Collect all relation types involved in this cycle
    const cycleRelTypes = collectCycleRelationTypes(sortedEntities, relationTypes);

    // Find Entity objects for severity computation
    const entityDetails = resolveEntityDetails(
      sortedEntities,
      entityMap,
      granularity,
      allEntities,
    );

    const severity = computeCycleSeverity(entityDetails, scc.length);

    return {
      id,
      entities: sortedEntities,
      granularity,
      severity,
      relation_types: cycleRelTypes,
      length: scc.length,
    };
  });

  // Filter by severity threshold
  const filtered = severity_threshold
    ? cycles.filter(
        (c) => SEVERITY_ORDER[c.severity] >= SEVERITY_ORDER[severity_threshold],
      )
    : cycles;

  // Sort by severity descending, then by length ascending for determinism
  return filtered.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.length - b.length;
  });
}

/**
 * Collect all unique relation types for edges between cycle members.
 */
function collectCycleRelationTypes(
  cycleEntities: string[],
  relationTypes: Map<string, Set<RelationType>>,
): RelationType[] {
  const entitySet = new Set(cycleEntities);
  const types = new Set<RelationType>();

  for (const from of entitySet) {
    for (const to of entitySet) {
      if (from === to) continue;
      const key = `${from}->${to}`;
      const edgeTypes = relationTypes.get(key);
      if (edgeTypes) {
        for (const t of edgeTypes) types.add(t);
      }
    }
  }

  return [...types].sort();
}

/**
 * Resolve entity details for severity computation.
 *
 * For file/module granularity, we find all entities belonging to each
 * collapsed node to compute severity from their metrics.
 */
function resolveEntityDetails(
  cycleNodeIds: string[],
  entityMap: Map<string, import('../contracts/entities.js').Entity>,
  granularity: CycleGranularity,
  allEntities: import('../contracts/entities.js').Entity[],
): import('../contracts/entities.js').Entity[] {
  if (granularity === 'file') {
    // cycleNodeIds are file paths — find entities in those files
    const files = new Set(cycleNodeIds);
    return allEntities.filter((e) => files.has(e.file));
  }

  if (granularity === 'module') {
    // cycleNodeIds are module names — find entities in those modules
    const modules = new Set(cycleNodeIds);
    return allEntities.filter((e) => {
      const parts = e.file.split('/');
      const mod = parts.length > 1 ? parts[0] : e.file;
      return modules.has(mod);
    });
  }

  // For function/all granularity, look up directly
  return cycleNodeIds
    .map((id) => entityMap.get(id))
    .filter((e): e is import('../contracts/entities.js').Entity => e !== undefined);
}
