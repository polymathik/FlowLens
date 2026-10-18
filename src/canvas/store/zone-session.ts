/**
 * Per-project zone choices (group-by, expanded / collapsed zones) kept in
 * sessionStorage so a reload of the tab keeps the arrangement. Storage can be
 * blocked or full (private windows, embedded webviews): every access is
 * wrapped and the map works without it.
 */
import { ZONING_MODES, type ZoningMode } from '../../contracts/zones.js';

export interface ZoneSession {
  groupBy: ZoningMode;
  zoneExpansion: Record<string, boolean>;
}

export const DEFAULT_GROUP_BY: ZoningMode = 'packages';
const KEY = (projectId: string) => `flowlens.zones.v1.${projectId}`;

export function readZoneSession(projectId?: string): ZoneSession {
  const fallback: ZoneSession = { groupBy: DEFAULT_GROUP_BY, zoneExpansion: {} };
  if (!projectId) return fallback;
  try {
    const raw = window.sessionStorage.getItem(KEY(projectId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ZoneSession>;
    const groupBy = ZONING_MODES.includes(parsed.groupBy as ZoningMode) ? (parsed.groupBy as ZoningMode) : DEFAULT_GROUP_BY;
    const zoneExpansion: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed.zoneExpansion ?? {})) if (typeof v === 'boolean') zoneExpansion[k] = v;
    return { groupBy, zoneExpansion };
  } catch {
    return fallback;
  }
}

export function writeZoneSession(projectId: string | undefined, session: ZoneSession): void {
  if (!projectId) return;
  try {
    window.sessionStorage.setItem(KEY(projectId), JSON.stringify(session));
  } catch {
    /* storage blocked or full: choices last for this page view only */
  }
}
