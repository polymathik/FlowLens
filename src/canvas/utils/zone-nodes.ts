/**
 * React Flow nodes of a zone view: expanded zones are frames (compound
 * parents), collapsed zones and files are cards. Parents come before their
 * children, children carry `parentId` + `extent: 'parent'` and positions
 * relative to the frame (set by the layout). Sizes are filled in by
 * `applyBoxes` once the layout is known.
 */
import type { Node } from '@xyflow/react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Zone } from '../../contracts/zones.js';
import { FOCUS_MORE_PREFIX, FOCUS_SELF_ZONE_ID, ZONE_LAYOUT, type CutItem, type FileNodeData, type MapView, type ZoneNodeData } from '../../contracts/canvas/index.js';
import { fileWeight } from '../../analysis/hierarchy/stats.js';
import type { BoxPos } from '../layout/cut-layout';
import { isRichCut } from '../layout/cut-layout';

/** Symbols a rich file card lists (top-level only, in source order of the hierarchy). */
export function fileSymbols(h: Hierarchy, fileId: string) {
  const kids = h.nodes.get(fileId)?.childIds ?? [];
  const rows = kids.slice(0, ZONE_LAYOUT.maxSymbolRows).flatMap((id) => {
    const n = h.nodes.get(id);
    return n?.symbolKind ? [{ name: n.name, kind: n.symbolKind }] : [];
  });
  return { rows, more: Math.max(0, kids.length - ZONE_LAYOUT.maxSymbolRows) };
}

export const symbolCountOf = (h: Hierarchy, fileId: string): number => h.nodes.get(fileId)?.childIds.length ?? 0;

function topFilesOf(h: Hierarchy, zones: Map<string, Zone>, zone: Zone): string[] {
  const files: string[] = [];
  const walk = (z: Zone) => {
    files.push(...z.fileIds);
    for (const c of z.childIds) {
      const child = zones.get(c);
      if (child) walk(child);
    }
  };
  walk(zone);
  return files
    .filter((f) => h.nodes.has(f))
    .sort((a, b) => fileWeight(h.nodes.get(b)!) - fileWeight(h.nodes.get(a)!) || (a < b ? -1 : 1))
    .slice(0, 3)
    .map((f) => h.nodes.get(f)!.name);
}

function box(id: string, type: 'zone' | 'file', data: Node['data'], item: CutItem): Node {
  const frame = item.kind === 'zone' && item.expanded;
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
    ...(item.parentId ? { parentId: item.parentId, extent: 'parent' as const } : {}),
    ...(frame ? { className: 'fl-zone-frame', draggable: false } : {}),
    ...(item.kind === 'zone' && !item.expanded ? { draggable: false } : {}),
  };
}

/** Frame, card and file nodes of a zone view (portals and the scope node are added by the caller). */
export function buildCutNodes(h: Hierarchy, view: MapView): Node[] {
  const cut = view.cut!;
  const zones = new Map((view.zoning?.zoneSet.zones ?? []).map((z) => [z.id, z]));
  const rich = isRichCut(cut);
  const focus = view.focus;
  return cut.items.map((item) => {
    if (item.kind === 'zone') {
      const zone = zones.get(item.zoneId!);
      const data: ZoneNodeData = {
        level: 'zone',
        label: item.label,
        zoneId: item.zoneId!,
        hierarchyId: item.hierarchyId,
        source: item.source ?? 'folder',
        colorIndex: item.colorIndex,
        expanded: item.expanded,
        depth: item.depth,
        fileCount: item.fileCount,
        symbolCount: zone?.stats.symbols ?? 0,
        topFiles: !item.expanded && zone ? topFilesOf(h, zones, zone) : [],
        qualityScore: zone?.stats.quality,
        churnRate: zone?.stats.churn,
        hotspotScore: zone?.stats.hotspot,
        customized: item.customized,
        detail: zone?.detail,
        ...(item.id === FOCUS_SELF_ZONE_ID ? { focusRole: 'focus' as const } : item.id.startsWith(FOCUS_MORE_PREFIX) ? { focusRole: 'more' as const } : {}),
      };
      return box(item.id, 'zone', data, item);
    }
    const n = h.nodes.get(item.id)!;
    const { rows, more } = rich ? fileSymbols(h, item.id) : { rows: [], more: 0 };
    const data: FileNodeData = {
      level: 'file',
      label: n.name,
      hierarchyId: n.id,
      filePath: n.path,
      symbolCount: n.stats.symbols,
      role: n.role,
      language: n.language,
      lines: n.stats.lines || undefined,
      qualityScore: n.stats.quality,
      churnRate: n.stats.churn,
      hotspotScore: n.stats.hotspot,
      rich,
      ...(rich ? { symbols: rows, moreSymbols: more } : {}),
      ...(item.parentId ? { zoneId: item.parentId } : {}),
      ...(focus ? { ...(focus.kind !== 'container' && focus.focusFiles.includes(item.id) ? { focus: true } : {}), ...(focus.beyond[item.id] ? { beyond: focus.beyond[item.id] } : {}) } : {}),
    };
    return box(item.id, 'file', data, item);
  });
}

/** Position and size nodes from the layout (positions are relative for children). */
export function applyBoxes(nodes: Node[], boxes: Map<string, BoxPos | { x: number; y: number; w?: number; h?: number }>): Node[] {
  return nodes.map((n) => {
    const b = boxes.get(n.id);
    if (!b) return n;
    const sized = b.w && b.h ? { width: b.w, height: b.h, style: { ...n.style, width: b.w, height: b.h } } : {};
    return { ...n, position: { x: b.x, y: b.y }, ...sized };
  });
}
