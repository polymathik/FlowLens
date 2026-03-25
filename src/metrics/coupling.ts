import type { GraphStore } from '../contracts/graph.js';
import type { EntityMetrics } from '../contracts/entities.js';

/**
 * Computes afferent/efferent coupling and instability for an entity
 * by querying the graph at call-time.
 *
 * - Afferent coupling (Ca): number of unique entities with edges pointing TO this entity
 * - Efferent coupling (Ce): number of unique entities with edges pointing FROM this entity
 * - Instability: Ce / (Ca + Ce), defaults to 0 when Ca and Ce are both 0
 *
 * This is intentionally query-time only — it is NOT called during indexing.
 */
export async function computeCouplingMetrics(
  entityId: string,
  graph: GraphStore,
): Promise<Pick<EntityMetrics, 'afferent_coupling' | 'efferent_coupling' | 'instability'>> {
  const [incomingEdges, outgoingEdges] = await Promise.all([
    graph.getEdgesTo(entityId),
    graph.getEdgesFrom(entityId),
  ]);

  const afferentSources = new Set(incomingEdges.map((rel) => rel.from));
  const efferentTargets = new Set(outgoingEdges.map((rel) => rel.to));

  const ca = afferentSources.size;
  const ce = efferentTargets.size;
  const instability = ca + ce === 0 ? 0 : ce / (ca + ce);

  return {
    afferent_coupling: ca,
    efferent_coupling: ce,
    instability,
  };
}
