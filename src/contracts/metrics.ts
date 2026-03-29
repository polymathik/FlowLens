import type { EntityKind, EntityMetrics } from './entities.js';
import type { GraphStore } from './graph.js';

export interface MetricsComputer {
  /** Compute static metrics (complexity, Halstead) from an AST node */
  computeMetrics(
    astNode: any,
    kind: EntityKind,
  ): EntityMetrics;

  /** Compute coupling metrics from graph topology (query-time, not stored) */
  computeCouplingMetrics(
    entityId: string,
    graph: GraphStore,
  ): Promise<Pick<EntityMetrics, 'afferent_coupling' | 'efferent_coupling' | 'instability'>>;

  /** Compute composite quality score from other metrics */
  computeQualityScore(metrics: EntityMetrics): number;
}
