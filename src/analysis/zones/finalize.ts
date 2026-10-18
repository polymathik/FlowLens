/**
 * finalizeZones — the shared back half of every strategy: apply user
 * overrides, then stats, display order, colours and default collapse.
 *
 * ```mermaid
 * flowchart LR
 *   S["strategy → ZoneDraft[]"] --> P["pins"] --> E["prune empty"] --> M["merges"] --> R["rename · colour · collapse"]
 *   R --> T["stats (from files)"] --> O["sort: label, key; Config last"] --> C["colours per sibling group"] --> D["default collapse"] --> Z["ZoneSet"]
 * ```
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import {
  ZONE_DEFAULT_COLLAPSE_ABOVE, type Zone, type ZoneOverrides, type ZoneSet, type ZoningMode, type ZoningOptions,
} from '../../contracts/zones.js';
import { assignColors } from './colors.js';
import type { ZoneDraft } from './draft.js';
import { compareText, zoneId } from './keys.js';
import { applyOverrides } from './overrides-apply.js';
import { addFile, emptyAcc, finishStats, mergeInto, type StatAcc } from './stats.js';
import { childrenOf, toWork, type WorkMap, type WorkZone } from './work.js';

export interface FinalizeInput {
  mode: ZoningMode;
  hierarchy: Hierarchy;
  /** Hierarchy node the zoning is scoped to (its folders stop the folder count). */
  scopeNodeId: string;
  drafts: ZoneDraft[];
  overrides?: ZoneOverrides;
  options?: ZoningOptions;
}

/**
 * Display order: an explicit `order` (layers: declaration order) first, then label and key
 * (case-insensitive); the muted Config / Unassigned zone goes last.
 */
export function compareZones(a: WorkZone, b: WorkZone): number {
  const ca = a.source === 'config' ? 1 : 0;
  const cb = b.source === 'config' ? 1 : 0;
  const oa = a.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.order ?? Number.MAX_SAFE_INTEGER;
  return ca - cb || oa - ob || compareText(a.label, b.label) || compareText(a.key, b.key);
}

function sortFiles(h: Hierarchy, ids: string[]): string[] {
  const path = (id: string): string => h.nodes.get(id)?.path ?? id;
  return [...new Set(ids)].sort((a, b) => compareText(path(a), path(b)) || (a < b ? -1 : a > b ? 1 : 0));
}

export function finalizeZones(input: FinalizeInput): ZoneSet {
  const { mode, hierarchy: h } = input;
  const zones: WorkMap = toWork(input.drafts);
  applyOverrides(zones, h, mode, input.overrides);

  const collapseAbove = input.options?.collapseAbove ?? ZONE_DEFAULT_COLLAPSE_ABOVE;
  const out = new Map<string, Zone>();
  const stats = new Map<string, StatAcc>();

  const build = (z: WorkZone, parentId: string | null, color: number): void => {
    const id = zoneId(mode, z.key);
    const kids = childrenOf(zones, z.key).sort(compareZones);
    const colors = assignColors(kids.map((k) => ({ key: k.key, fixed: k.color })), color);
    const files = sortFiles(h, z.fileIds);
    z.fileIds = files;
    const zone: Zone = {
      id, key: z.key, label: z.label, source: z.source, parentId, fileIds: files,
      childIds: kids.map((k) => zoneId(mode, k.key)), colorIndex: color,
      collapsed: false, stats: { files: 0, folders: 0, symbols: 0, lines: 0 },
    };
    if (z.nodeId) zone.nodeId = z.nodeId;
    if (z.customized) zone.customized = true;
    if (z.detail) zone.detail = z.detail;
    out.set(id, zone);
    kids.forEach((k, i) => build(k, id, colors[i]));
    // stats: own files + children
    const acc = emptyAcc();
    const stop = new Set([input.scopeNodeId, ...(z.nodeId ? [z.nodeId] : [])]);
    for (const f of files) addFile(h, acc, f, stop);
    for (const k of kids) mergeInto(acc, stats.get(zoneId(mode, k.key))!, k.nodeId);
    stats.set(id, acc);
    zone.stats = finishStats(acc);
    zone.collapsed = z.collapsed ?? (z.absorbed || z.startCollapsed === true || zone.stats.files > collapseAbove);
  };

  const roots = [...zones.values()].filter((z) => z.parentKey === null).sort(compareZones);
  const rootColors = assignColors(roots.map((r) => ({ key: r.key, fixed: r.color })));
  roots.forEach((r, i) => build(r, null, rootColors[i]));

  const zoneOfFile: Record<string, string> = {};
  for (const z of out.values()) for (const f of z.fileIds) zoneOfFile[f] = z.id;
  return { mode, zones: [...out.values()], rootIds: roots.map((r) => zoneId(mode, r.key)), zoneOfFile };
}
