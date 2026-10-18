/**
 * Merging the communities just computed into the stored assignment (file path → community key).
 * Only files of detected communities are recorded (package manifests, config and custom zones carry no
 * clustering information). Pure; `mergeAssignment` returns the SAME object when nothing changed, so callers can skip the save.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { ZoneSet } from '../../contracts/zones.js';

/** Only whole packages and the whole project give partitions that do not depend on the scope being viewed. */
export const recordsAssignment = (h: Hierarchy, containerId: string): boolean => {
  const kind = h.nodes.get(containerId)?.kind;
  return kind === 'project' || kind === 'package';
};

export function mergeAssignment(
  previous: Readonly<Record<string, string>>,
  zoneSet: ZoneSet,
  h: Hierarchy,
  pins: Readonly<Record<string, string>>,
): Record<string, string> {
  const byId = new Map(zoneSet.zones.map((z) => [z.id, z]));
  const next: Record<string, string> = {};
  for (const [path, key] of Object.entries(previous)) if (h.byFile.has(path)) next[path] = key;
  for (const [fileId, zoneId] of Object.entries(zoneSet.zoneOfFile)) {
    const zone = byId.get(zoneId);
    const path = h.nodes.get(fileId)?.path;
    if (!zone || !path || zone.source !== 'community' || pins[path] !== undefined) continue;
    next[path] = zone.key;
  }
  const a = Object.keys(next);
  const same = a.length === Object.keys(previous).length && a.every((p) => previous[p] === next[p]);
  return same ? (previous as Record<string, string>) : next;
}
