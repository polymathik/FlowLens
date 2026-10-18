/**
 * Shared per-layer counting helpers used by get_summary, get_layer_map,
 * check_architecture and cycle severity.
 */

import type { Entity } from '../contracts/entities.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import { buildLayerMap } from './architecture-validator.js';

/** entity id -> layer name (null = unassigned). */
export const assignLayers = buildLayerMap;

export interface LayerCounts {
  /** In config order; every configured layer present (0 when empty). */
  counts: Map<string, number>;
  unassigned: number;
}

export function countEntitiesByLayer(
  entities: Entity[],
  config: ArchitectureConfig,
  assignment: Map<string, string | null> = assignLayers(entities, config),
): LayerCounts {
  const counts = new Map<string, number>(config.layers.map((l) => [l.name, 0]));
  let unassigned = 0;
  for (const e of entities) {
    const layer = assignment.get(e.id) ?? null;
    if (layer) counts.set(layer, (counts.get(layer) ?? 0) + 1);
    else unassigned++;
  }
  return { counts, unassigned };
}

/** Violations counted against their source layer, every configured layer present. */
export function countViolationsByLayer(
  violations: ArchitectureViolation[],
  config: ArchitectureConfig,
): Map<string, number> {
  const counts = new Map<string, number>(config.layers.map((l) => [l.name, 0]));
  for (const v of violations) counts.set(v.layer_from, (counts.get(v.layer_from) ?? 0) + 1);
  return counts;
}
