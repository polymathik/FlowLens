/**
 * Zoning service (pure; safe to import from the canvas bundle).
 *
 *   computeZones({ mode, hierarchy, scopeId?, overrides?, options? }) → ZoneSet
 *
 * See `contracts/zones.ts`. Node-only persistence lives in
 * `overrides-store.ts` (not exported here so the bundle stays free of node:fs).
 */
import { communitiesStrategy } from './communities/index.js';
import { registerZoning } from './registry.js';

export { computeZones, registerZoning, hasZoning, draftStrategy } from './registry.js';
export { finalizeZones, compareZones, type FinalizeInput } from './finalize.js';
export type { ZoneDraft } from './draft.js';
export { zoneId, hashKey, compareText } from './keys.js';
export { assignColors } from './colors.js';
export { buildFileGraph } from './communities/index.js';

registerZoning('communities', communitiesStrategy);

// Built-in strategies that live in their own module register themselves on import.
import './layers.js';
export { layerRulesText } from './layers.js';
