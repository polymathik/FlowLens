/**
 * Zoning service (pure; safe to import from the canvas bundle).
 *
 *   computeZones({ mode, hierarchy, scopeId?, overrides?, options? }) → ZoneSet
 *
 * See `contracts/zones.ts`. Node-only persistence lives in
 * `overrides-store.ts` (not exported here so the bundle stays free of node:fs).
 */
export { computeZones, registerZoning, hasZoning, draftStrategy } from './registry.js';
export { finalizeZones, compareZones, type FinalizeInput } from './finalize.js';
export type { ZoneDraft } from './draft.js';
export { zoneId, hashKey, compareText } from './keys.js';
export { assignColors } from './colors.js';
