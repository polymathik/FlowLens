import type { GraphStore } from '../contracts/graph.js';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { FileChurnData } from '../contracts/analysis/churn.js';
import type { HotspotEntry } from '../contracts/analysis/hotspots.js';

export interface HotspotOptions {
  kind?: EntityKind;
  min_score?: number;
  /** Keep entities whose score is 0 (complex but unchanged in the churn window). */
  include_zero?: boolean;
  max_results?: number;
}

/** Hotspot = churn_rate × cognitive complexity, highest first. */
export async function computeHotspots(
  graph: GraphStore,
  churnData: Map<string, FileChurnData>,
  options?: HotspotOptions,
): Promise<HotspotEntry[]> {
  const [entities, edges] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const inbound = new Map<string, Relation[]>();
  for (const e of edges) {
    if (!inbound.has(e.to)) inbound.set(e.to, []);
    inbound.get(e.to)!.push(e);
  }
  return computeHotspotsInData(entities, (id) => inbound.get(id) ?? [], churnData, options);
}

/** Pure variant; `edgesTo` returns inbound relations of an entity. */
export function computeHotspotsInData(
  entities: Entity[],
  edgesTo: (id: string) => Relation[],
  churnData: Map<string, FileChurnData>,
  options?: HotspotOptions,
): HotspotEntry[] {
  const entries: HotspotEntry[] = [];

  for (const entity of entities) {
    const cc = entity.metrics?.cognitive_complexity;
    if (cc === undefined || cc === 0) continue;
    if (options?.kind && entity.kind !== options.kind) continue;

    const churn = churnData.get(entity.file);
    const churnRate = churn?.churn_rate ?? 0;
    const hotspotScore = churnRate * cc;

    if (hotspotScore <= 0 && !options?.include_zero) continue;
    if (options?.min_score !== undefined && hotspotScore < options.min_score) continue;

    // Dependents: distinct referencing entities, excluding structural containment.
    const dependents = new Set(edgesTo(entity.id).filter((r) => r.type !== 'contain').map((r) => r.from));

    entries.push({
      entity_id: entity.id,
      entity_name: entity.name,
      entity_kind: entity.kind,
      file: entity.file,
      hotspot_score: hotspotScore,
      churn_rate: churnRate,
      cognitive_complexity: cc,
      dependent_count: dependents.size,
      qualified_name: entity.qualified_name,
      change_count: churn?.change_count ?? 0,
      last_changed: churn?.last_changed ?? '',
    });
  }

  entries.sort((a, b) => b.hotspot_score - a.hotspot_score || a.entity_id.localeCompare(b.entity_id));
  return options?.max_results ? entries.slice(0, options.max_results) : entries;
}
