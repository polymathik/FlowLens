import type { GraphStore } from '../contracts/graph.js';
import type { EntityKind } from '../contracts/entities.js';
import type { FileChurnData } from '../contracts/analysis/churn.js';
import type { HotspotEntry } from '../contracts/analysis/hotspots.js';

export async function computeHotspots(
  graph: GraphStore,
  churnData: Map<string, FileChurnData>,
  options?: { kind?: EntityKind; min_score?: number; max_results?: number },
): Promise<HotspotEntry[]> {
  const allEntities = await graph.getAllNodes();
  const entries: HotspotEntry[] = [];

  for (const entity of allEntities) {
    const cc = entity.metrics?.cognitive_complexity;
    if (cc === undefined || cc === 0) continue;
    if (options?.kind && entity.kind !== options.kind) continue;

    const churn = churnData.get(entity.file);
    const churnRate = churn?.churn_rate ?? 0;
    const hotspotScore = churnRate * cc;

    if (options?.min_score && hotspotScore < options.min_score) continue;

    // Count dependents (afferent coupling)
    const edgesTo = await graph.getEdgesTo(entity.id);
    const dependentCount = new Set(edgesTo.map(e => e.from)).size;

    entries.push({
      entity_id: entity.id,
      entity_name: entity.name,
      entity_kind: entity.kind,
      file: entity.file,
      hotspot_score: hotspotScore,
      churn_rate: churnRate,
      cognitive_complexity: cc,
      dependent_count: dependentCount,
    });
  }

  // Sort by hotspot_score descending
  entries.sort((a, b) => b.hotspot_score - a.hotspot_score);

  if (options?.max_results) {
    return entries.slice(0, options.max_results);
  }
  return entries;
}
