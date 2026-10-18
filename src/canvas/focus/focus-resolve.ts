/**
 * What a focus id stands for: one file, one symbol (with the nodes below it), or a container
 * (folder, package, config group or zone) that is drawn as a single card. Pure.
 */
import { PROJECT_NODE_ID, type Hierarchy } from '../../contracts/hierarchy.js';
import type { FocusKind } from '../../contracts/canvas/index.js';
import type { Zone, ZoneSet } from '../../contracts/zones.js';
import { resolveRef } from '../../analysis/hierarchy/index.js';
import { visibleFiles } from '../utils/view-scope';
import { fileOfNode } from './focus-index';

export interface ResolvedFocus {
  kind: FocusKind;
  /** Hierarchy node id, or the zone id for a zone. */
  focusId: string;
  label: string;
  /** The files that make up the focus. */
  files: string[];
  /** Symbol focus: the symbol and every node below it. */
  startNodes: string[];
  /** Zone focus: the zone behind it (colour and label of the stand-in card). */
  zone?: Zone;
}

export const isZoneId = (id: string): boolean => id.startsWith('zone:');

function zoneFiles(zoneSet: ZoneSet, zone: Zone, visible: ReadonlySet<string>): string[] {
  const byId = new Map(zoneSet.zones.map((z) => [z.id, z]));
  const out: string[] = [];
  const walk = (z: Zone) => {
    for (const f of z.fileIds) if (visible.has(f)) out.push(f);
    for (const c of z.childIds) {
      const child = byId.get(c);
      if (child) walk(child);
    }
  };
  walk(zone);
  return out;
}

function below(h: Hierarchy, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) out.push(...(h.nodes.get(out[i])?.childIds ?? []));
  return out;
}

export function resolveFocus(h: Hierarchy, zoneSet: ZoneSet, requestedId: string, showLockfiles = false): ResolvedFocus | null {
  const all = visibleFiles(h, PROJECT_NODE_ID, showLockfiles);
  if (isZoneId(requestedId)) {
    const zone = zoneSet.zones.find((z) => z.id === requestedId);
    const files = zone ? zoneFiles(zoneSet, zone, new Set(all)) : [];
    return zone && files.length > 0 ? { kind: 'container', focusId: zone.id, label: zone.label, files, startNodes: [], zone } : null;
  }
  const id = resolveRef(h, requestedId);
  const node = id ? h.nodes.get(id) : undefined;
  if (!id || !node || id === PROJECT_NODE_ID) return null;
  if (node.kind === 'file') return { kind: 'file', focusId: id, label: node.name, files: [id], startNodes: [] };
  if (node.kind === 'symbol') {
    const file = fileOfNode(h, id);
    return file ? { kind: 'symbol', focusId: id, label: node.name, files: [file], startNodes: below(h, id) } : null;
  }
  const inside = new Set(visibleFiles(h, id, showLockfiles));
  const files = all.filter((f) => inside.has(f));
  return files.length > 0 ? { kind: 'container', focusId: id, label: node.name, files, startNodes: [] } : null;
}
