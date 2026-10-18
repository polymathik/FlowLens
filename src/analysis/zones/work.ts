/** Mutable zone state while overrides are applied (internal to `finalizeZones`). */
import type { ZoneSource } from '../../contracts/zones.js';
import type { ZoneDraft } from './draft.js';

export interface WorkZone {
  key: string;
  label: string;
  source: ZoneSource;
  parentKey: string | null;
  fileIds: string[];
  nodeId?: string;
  absorbed: boolean;
  customized: boolean;
  order?: number;
  startCollapsed?: boolean;
  detail?: string;
  /** Forced by an override. */
  color?: number;
  collapsed?: boolean;
}

export type WorkMap = Map<string, WorkZone>;

export function toWork(drafts: ZoneDraft[]): WorkMap {
  const map: WorkMap = new Map();
  for (const d of drafts) {
    map.set(d.key, {
      key: d.key, label: d.label, source: d.source, parentKey: d.parentKey, fileIds: [...d.fileIds],
      nodeId: d.nodeId, absorbed: d.absorbed === true, customized: false,
      order: d.order, startCollapsed: d.startCollapsed, detail: d.detail,
    });
  }
  for (const z of map.values()) if (z.parentKey !== null && !map.has(z.parentKey)) z.parentKey = null;
  return map;
}

export const childrenOf = (zones: WorkMap, key: string): WorkZone[] => [...zones.values()].filter((z) => z.parentKey === key);

/** True when `key` is `ancestor` or sits below it. */
export function isWithin(zones: WorkMap, key: string, ancestor: string): boolean {
  for (let cur: string | null = key, guard = 0; cur !== null && guard < 10_000; guard++) {
    if (cur === ancestor) return true;
    cur = zones.get(cur)?.parentKey ?? null;
  }
  return false;
}
