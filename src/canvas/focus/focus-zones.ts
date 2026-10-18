/**
 * Zones of a focus view: the current grouping (Group-by) restricted to the files that are drawn.
 *
 *  - zones keep their identity, label, colour and order; nesting is flattened to what the cut can show
 *    as frames (`ZONE_LAYOUT.maxDepth`), so a neighbour is never hidden inside a deep card;
 *  - neighbours cut by the cap sit in one collapsed "+N more" zone per owning zone; open it to list them;
 *  - a focused container (folder, package, zone) is ONE collapsed card in front, standing for all its files.
 *
 * Pure: the base `ZoneSet` is whatever `getZones` produced for the project.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Zone, ZoneSet } from '../../contracts/zones.js';
import { FOCUS_MORE_PREFIX, FOCUS_SELF_ZONE_ID, ZONE_LAYOUT } from '../../contracts/canvas/index.js';
import type { HierarchyStats } from '../../contracts/hierarchy.js';
import type { ResolvedFocus } from './focus-resolve';

const statsOf = (h: Hierarchy, files: string[]): HierarchyStats => {
  const s: HierarchyStats = { files: files.length, folders: 0, symbols: 0, lines: 0 };
  for (const f of files) {
    const n = h.nodes.get(f);
    s.symbols += n?.stats.symbols ?? 0;
    s.lines += n?.stats.lines ?? 0;
  }
  return s;
};

const NO_ZONE = 'root';

export function deriveFocusZones(h: Hierarchy, base: ZoneSet, focus: ResolvedFocus, shown: string[], folded: string[]): ZoneSet {
  const byId = new Map(base.zones.map((z) => [z.id, z]));
  const depthOf = (z: Zone): number => {
    let d = 0;
    for (let p = z.parentId ? byId.get(z.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) d++;
    return d;
  };
  /** The zone a file is drawn in: its innermost zone, lifted to the deepest level that can be a frame. */
  const ownerOf = (f: string): Zone | undefined => {
    let z = byId.get(base.zoneOfFile[f] ?? '');
    while (z && depthOf(z) > ZONE_LAYOUT.maxDepth - 1) z = z.parentId ? byId.get(z.parentId) : undefined;
    // The scope's own "Root" zone (loose files) is never a frame.
    return z && z.parentId === null && z.key === '.' ? undefined : z;
  };

  const own = new Map<string, string[]>(); // zone id → files drawn directly in it
  const more = new Map<string, string[]>(); // zone id (or NO_ZONE) → folded files
  const used = new Set<string>();
  const markUsed = (z: Zone | undefined) => {
    for (let cur = z; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) used.add(cur.id);
  };
  const place = (f: string, into: Map<string, string[]>) => {
    const z = ownerOf(f);
    markUsed(z);
    const key = z?.id ?? NO_ZONE;
    (into.get(key) ?? into.set(key, []).get(key)!).push(f);
  };
  for (const f of shown) place(f, own);
  if (focus.kind !== 'container') for (const f of focus.files) place(f, own);
  for (const f of folded) place(f, more);

  const moreZone = (owner: Zone | undefined, files: string[]): Zone => ({
    id: `${FOCUS_MORE_PREFIX}${owner?.id ?? NO_ZONE}`,
    key: `focus-more:${owner?.key ?? NO_ZONE}`,
    label: `+${files.length} more`,
    source: 'custom',
    parentId: owner?.id ?? null,
    fileIds: files,
    childIds: [],
    colorIndex: owner?.colorIndex ?? 5,
    collapsed: true,
    stats: statsOf(h, files),
    detail: `${files.length} more neighbour${files.length === 1 ? '' : 's'} beyond the card cap. Open this card to list them.`,
  });

  const zones: Zone[] = [];
  const zoneOfFile: Record<string, string> = {};
  const rootIds: string[] = [];
  if (focus.kind === 'container') {
    const self: Zone = {
      id: FOCUS_SELF_ZONE_ID,
      key: 'focus:self',
      label: focus.label,
      source: 'custom',
      parentId: null,
      fileIds: focus.files,
      childIds: [],
      colorIndex: focus.zone?.colorIndex ?? 5,
      collapsed: true,
      stats: statsOf(h, focus.files),
      detail: `Focus: ${focus.label} (${focus.files.length} file${focus.files.length === 1 ? '' : 's'}), shown as one card.`,
    };
    zones.push(self);
    rootIds.push(self.id);
    for (const f of focus.files) zoneOfFile[f] = self.id;
  }
  const extra = new Map<string, Zone>();
  for (const [key, files] of more) extra.set(key, moreZone(byId.get(key), files));
  for (const z of base.zones) {
    if (!used.has(z.id)) continue;
    const mz = extra.get(z.id);
    const childIds = [...z.childIds.filter((c) => used.has(c)), ...(mz ? [mz.id] : [])];
    const mine = own.get(z.id) ?? [];
    zones.push({ ...z, fileIds: mine, childIds });
    for (const f of mine) zoneOfFile[f] = z.id;
    if (mz) {
      zones.push(mz);
      for (const f of mz.fileIds) zoneOfFile[f] = mz.id;
    }
    if (z.parentId === null) rootIds.push(z.id);
  }
  const top = extra.get(NO_ZONE);
  if (top) {
    zones.push(top);
    rootIds.push(top.id);
    for (const f of top.fileIds) zoneOfFile[f] = top.id;
  }
  // Roots keep the base order (self first); the base order of zones also orders the roots.
  const order = new Map(base.rootIds.map((id, i) => [id, i]));
  rootIds.sort((a, b) => (a === FOCUS_SELF_ZONE_ID ? -1 : b === FOCUS_SELF_ZONE_ID ? 1 : (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)));
  return { ...base, zones, rootIds, zoneOfFile };
}
