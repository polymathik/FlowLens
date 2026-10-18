/**
 * The ONE import site of the zoning service for the canvas. Everything in the
 * canvas depends only on the `ZoneSet` / `ZoningInput` contract
 * (`contracts/zones.ts`); the producer lives in `src/analysis/zones`.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { ZONE_CONFIG_KEY, type Zone } from '../../contracts/zones.js';
import { configId } from '../../analysis/hierarchy/ids.js';

export { computeZones as getZones } from '../../analysis/zones/index.js';

/** Hierarchy node a zone stands for: the producer's `nodeId`, else resolved from its source and key. */
export function hierarchyIdOfZone(h: Hierarchy, zone: Zone, scopeId?: string): string | undefined {
  if (zone.key === ZONE_CONFIG_KEY) {
    // The Config zone gathers the config files of the open scope: it is that scope's `config:` group.
    const id = configId(scopeId ? (h.nodes.get(scopeId)?.path ?? '') : '');
    return h.nodes.has(id) ? id : undefined;
  }
  if (zone.nodeId && h.nodes.has(zone.nodeId)) return zone.nodeId;
  if (zone.source === 'folder') return h.byDir.get(zone.key);
  if (zone.source === 'package') {
    for (const n of h.nodes.values()) if (n.kind === 'package' && (n.name === zone.key || n.path === zone.key)) return n.id;
    return undefined;
  }
  if (zone.source === 'config') {
    const id = `config:${zone.key.replace(/\/config$/, '')}`;
    return h.nodes.has(id) ? id : undefined;
  }
  return undefined;
}
