/**
 * Applies `.flowlens/zones.json` to a zone tree. The order is the
 * precedence: pins (membership) → prune emptied zones → merges (structure)
 * → rename / colour / collapse (presentation). Overrides always win over
 * what a strategy produced; entries that do not fit (unknown file, missing
 * merge target, other mode) are ignored, never an error.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import {
  EMPTY_ZONE_OVERRIDES, ZONE_COLOR_SLOTS, ZONING_MODES, type ZoneOverrides, type ZoningMode,
} from '../../contracts/zones.js';
import { compareText, normalizePath } from './keys.js';
import { childrenOf, isWithin, type WorkMap, type WorkZone } from './work.js';

/** `<mode>:<key>` → key when it addresses `mode`; a bare key (no mode prefix) also counts; null for another mode. */
export function keyForMode(mode: ZoningMode, ref: string): string | null {
  if (ref.startsWith(`${mode}:`)) return ref.slice(mode.length + 1) || null;
  const other = ZONING_MODES.find((m) => ref.startsWith(`${m}:`));
  return other ? null : ref || null;
}

const sortedEntries = <T>(rec: Record<string, T>): Array<[string, T]> =>
  Object.entries(rec).sort(([a], [b]) => compareText(a, b));

function customZone(key: string): WorkZone {
  return { key, label: key, source: 'custom', parentKey: null, fileIds: [], absorbed: false, customized: true };
}

/** Move pinned files into their zones (creating custom zones on demand). */
export function applyPins(zones: WorkMap, h: Hierarchy, mode: ZoningMode, pins: ZoneOverrides['pins']): void {
  const owner = new Map<string, string>();
  for (const z of zones.values()) for (const f of z.fileIds) owner.set(f, z.key);
  for (const [path, ref] of sortedEntries(pins)) {
    const destKey = keyForMode(mode, ref);
    const fileId = h.byFile.get(normalizePath(path));
    const from = fileId ? owner.get(fileId) : undefined;
    if (!destKey || !fileId || from === undefined || from === destKey) continue;
    let dest = zones.get(destKey);
    if (!dest) zones.set(destKey, (dest = customZone(destKey)));
    const src = zones.get(from)!;
    src.fileIds = src.fileIds.filter((f) => f !== fileId);
    src.customized = true;
    dest.fileIds.push(fileId);
    dest.customized = true;
    owner.set(fileId, destKey);
  }
}

/** Drop zones left without files and children (bottom-up). */
export function pruneEmpty(zones: WorkMap): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const z of [...zones.values()]) {
      if (z.fileIds.length === 0 && childrenOf(zones, z.key).length === 0) {
        zones.delete(z.key);
        changed = true;
      }
    }
  }
}

/** Merge zones into other zones; children are re-parented, chains and cycles are resolved safely. */
export function applyMerges(zones: WorkMap, mode: ZoningMode, overrides: ZoneOverrides['zones']): void {
  const mergedInto = new Map<string, string>();
  const live = (key: string): string => {
    let cur = key;
    for (let guard = 0; mergedInto.has(cur) && guard < 1_000; guard++) cur = mergedInto.get(cur)!;
    return cur;
  };
  for (const [ref, ov] of sortedEntries(overrides)) {
    const srcKey = keyForMode(mode, ref);
    const target = ov.mergeInto ? keyForMode(mode, ov.mergeInto) : null;
    if (!srcKey || !target || !zones.has(srcKey) || !zones.has(target)) continue;
    const dstKey = live(target);
    const src = zones.get(srcKey)!;
    const dst = zones.get(dstKey);
    if (!dst || dstKey === srcKey || isWithin(zones, dstKey, srcKey)) continue;
    dst.fileIds.push(...src.fileIds);
    dst.absorbed ||= src.absorbed;
    dst.customized = true;
    for (const child of childrenOf(zones, srcKey)) child.parentKey = dstKey;
    zones.delete(srcKey);
    mergedInto.set(srcKey, dstKey);
  }
}

/** Rename / recolour / collapse. */
export function applyPresentation(zones: WorkMap, mode: ZoningMode, overrides: ZoneOverrides['zones']): void {
  for (const [ref, ov] of Object.entries(overrides)) {
    const key = keyForMode(mode, ref);
    const z = key ? zones.get(key) : undefined;
    if (!z) continue;
    const name = ov.name?.trim();
    if (name) {
      z.label = name;
      z.customized = true;
    }
    if (ov.color !== undefined && Number.isInteger(ov.color) && ov.color >= 0 && ov.color < ZONE_COLOR_SLOTS) {
      z.color = ov.color;
      z.customized = true;
    }
    if (ov.collapsed !== undefined) {
      z.collapsed = ov.collapsed;
      z.customized = true;
    }
  }
}

export function applyOverrides(zones: WorkMap, h: Hierarchy, mode: ZoningMode, overrides: ZoneOverrides = EMPTY_ZONE_OVERRIDES): void {
  applyPins(zones, h, mode, overrides.pins);
  pruneEmpty(zones);
  applyMerges(zones, mode, overrides.zones);
  applyPresentation(zones, mode, overrides.zones);
}
