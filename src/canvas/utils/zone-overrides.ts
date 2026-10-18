/**
 * Pure edits of `ZoneOverrides` (`.flowlens/zones.json`): rename, recolour,
 * collapse and pin a file to a zone. Each returns a new object; empty
 * entries are dropped so the stored file stays small. The reference of a
 * zone is `<mode>:<key>` (see `Zone.key`).
 */
import { ZONE_COLOR_SLOTS, type ZoneOverride, type ZoneOverrides, type ZoningMode } from '../../contracts/zones.js';

export const zoneRef = (mode: ZoningMode, key: string): string => `${mode}:${key}`;

function patch(o: ZoneOverrides, ref: string, change: Partial<ZoneOverride>): ZoneOverrides {
  const next: ZoneOverride = { ...o.zones[ref], ...change };
  for (const k of Object.keys(next) as Array<keyof ZoneOverride>) if (next[k] === undefined) delete next[k];
  const zones = { ...o.zones };
  if (Object.keys(next).length === 0) delete zones[ref];
  else zones[ref] = next;
  return { ...o, zones };
}

export const renameZone = (o: ZoneOverrides, ref: string, name: string): ZoneOverrides => patch(o, ref, { name: name.trim() || undefined });

export const recolorZone = (o: ZoneOverrides, ref: string, color: number): ZoneOverrides =>
  patch(o, ref, { color: ((Math.round(color) % ZONE_COLOR_SLOTS) + ZONE_COLOR_SLOTS) % ZONE_COLOR_SLOTS });

export const collapseZone = (o: ZoneOverrides, ref: string, collapsed: boolean): ZoneOverrides => patch(o, ref, { collapsed });

/** Pin a file path to a zone ref; the file belongs to exactly that zone from now on. */
export const pinFile = (o: ZoneOverrides, filePath: string, targetRef: string): ZoneOverrides => ({ ...o, pins: { ...o.pins, [filePath]: targetRef } });

export const unpinFile = (o: ZoneOverrides, filePath: string): ZoneOverrides => {
  const pins = { ...o.pins };
  delete pins[filePath];
  return { ...o, pins };
};
