/**
 * The CUT of the zone tree: which zones are frames, which are cards, which
 * files are cards — for the open container. Pure.
 *
 * Expansion, in order of precedence:
 *   1. depth cap       zones nested deeper than `maxDepth` are always cards
 *   2. user choice     `expansion["<container>|<item>"]` (chip click, Expand / Collapse all)
 *   3. reveal          search / deep link reaching a file inside the zone
 *   4. node budget     the largest default-expanded zones collapse until the cut fits
 *   5. override        `zones.json` `collapsed`
 *   6. default         expand everything when the container has at most `expandAllUpTo`
 *                      files, else only zones of at most `collapseAbove` files
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Zone, ZoneSet, ZoningMode } from '../../contracts/zones.js';
import { ZONE_LAYOUT, type CutItem, type MapCut, type ZoneViewOptions } from '../../contracts/canvas/index.js';
import { hierarchyIdOfZone } from './zones-adapter';

/** Node slots kept free for portals and the scope node when applying the budget. */
const RESERVED_NODES = 24;

export const expansionKey = (containerId: string, itemId: string): string => `${containerId}|${itemId}`;

/** Zone id → item (React Flow node) id: the hierarchy id when the zone has a node of its own, else the zone id. */
export function zoneItemIds(h: Hierarchy, zoneSet: ZoneSet): Map<string, string> {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const z of zoneSet.zones) {
    const own = hierarchyIdOfZone(h, z);
    const id = own && !used.has(own) ? own : z.id;
    used.add(id);
    ids.set(z.id, id);
  }
  return ids;
}

export interface CutInput {
  h: Hierarchy;
  zoneSet: ZoneSet;
  containerId: string;
  /** Visible file node ids below the container. */
  files: string[];
  mode: ZoningMode;
  options: ZoneViewOptions;
}

const nameOf = (h: Hierarchy, id: string) => h.nodes.get(id)?.name ?? id;

function byFileName(h: Hierarchy) {
  return (a: string, b: string) => {
    const x = nameOf(h, a);
    const y = nameOf(h, b);
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
  };
}

export function buildCut(input: CutInput): MapCut {
  const { h, zoneSet, containerId, files, mode, options } = input;
  const zoneById = new Map(zoneSet.zones.map((z) => [z.id, z]));
  const fileSet = new Set(files);
  const reveal = new Set(options.reveal ?? []);
  const sortFiles = byFileName(h);

  const recCounts = new Map<string, number>();
  const recCount = (z: Zone): number => {
    let n = recCounts.get(z.id);
    if (n === undefined) {
      n = z.fileIds.filter((f) => fileSet.has(f)).length;
      for (const c of z.childIds) {
        const child = zoneById.get(c);
        if (child) n += recCount(child);
      }
      recCounts.set(z.id, n);
    }
    return n;
  };

  const itemIds = zoneItemIds(h, zoneSet);

  const isProtected = (itemId: string) => options.expansion[expansionKey(containerId, itemId)] === true || reveal.has(itemId);

  function build(autoCollapsed: ReadonlySet<string>): MapCut {
    const items: CutItem[] = [];
    const atomOfFile: Record<string, string> = {};
    let budgetCollapsed = 0;

    const decide = (z: Zone, itemId: string, depth: number, total: number): { expanded: boolean; by?: CutItem['collapsedBy'] } => {
      if (depth >= ZONE_LAYOUT.maxDepth) return { expanded: false, by: 'depth' };
      if (reveal.has(itemId)) return { expanded: true };
      const explicit = options.expansion[expansionKey(containerId, itemId)];
      if (explicit !== undefined) return { expanded: explicit, by: explicit ? undefined : 'user' };
      if (autoCollapsed.has(itemId)) return { expanded: false, by: 'budget' };
      const ov = options.overrides?.zones[`${mode}:${z.key}`]?.collapsed;
      if (ov !== undefined) return { expanded: !ov, by: ov ? 'override' : undefined };
      if (z.collapsed) return { expanded: false, by: 'override' };
      const open = files.length <= ZONE_LAYOUT.expandAllUpTo || total <= ZONE_LAYOUT.collapseAbove;
      return { expanded: open, by: open ? undefined : 'default' };
    };

    const assign = (z: Zone, itemId: string) => {
      for (const f of z.fileIds) if (fileSet.has(f)) atomOfFile[f] = itemId;
      for (const c of z.childIds) {
        const child = zoneById.get(c);
        if (child) assign(child, itemId);
      }
    };

    const fileItem = (id: string, parentId: string | null, depth: number, colorIndex: number): CutItem => ({
      id,
      kind: 'file',
      hierarchyId: id,
      label: nameOf(h, id),
      colorIndex,
      parentId,
      depth,
      expanded: false,
      childIds: [],
      fileCount: 1,
    });

    const zoneItem = (z: Zone, parentId: string | null, depth: number): string | null => {
      const total = recCount(z);
      if (total === 0) return null;
      const itemId = itemIds.get(z.id)!;
      const { expanded, by } = decide(z, itemId, depth, total);
      const item: CutItem = {
        id: itemId,
        kind: 'zone',
        zoneId: z.id,
        hierarchyId: hierarchyIdOfZone(h, z),
        label: z.label,
        source: z.source,
        colorIndex: z.colorIndex,
        parentId,
        depth,
        expanded,
        childIds: [],
        fileCount: total,
        collapsedBy: by,
        customized: z.customized,
      };
      items.push(item);
      if (!expanded) {
        if (by === 'budget') budgetCollapsed++;
        assign(z, itemId);
        return itemId;
      }
      for (const c of z.childIds) {
        const child = zoneById.get(c);
        const id = child && zoneItem(child, itemId, depth + 1);
        if (id) item.childIds.push(id);
      }
      for (const f of [...z.fileIds].filter((x) => fileSet.has(x)).sort(sortFiles)) {
        items.push(fileItem(f, itemId, depth + 1, z.colorIndex));
        atomOfFile[f] = f;
        item.childIds.push(f);
      }
      return itemId;
    };

    const topIds: string[] = [];
    for (const rootId of zoneSet.rootIds) {
      const root = zoneById.get(rootId);
      const id = root && zoneItem(root, null, 0);
      if (id) topIds.push(id);
    }
    for (const f of files.filter((x) => !zoneSet.zoneOfFile[x] || !zoneById.has(zoneSet.zoneOfFile[x])).sort(sortFiles)) {
      items.push(fileItem(f, null, 0, 5));
      atomOfFile[f] = f;
      topIds.push(f);
    }
    return { items, topIds, atomOfFile, budgetCollapsed, totalFiles: files.length, revealed: [...reveal].filter((id) => items.some((i) => i.id === id)) };
  }

  // Node budget: collapse the largest zones that were only expanded by default (then, past the hard
  // ceiling, ones the user expanded) until the cut fits.
  const cap = (options.nodeBudget ?? ZONE_LAYOUT.nodeBudget) - RESERVED_NODES;
  const auto = new Set<string>();
  let cut = build(auto);
  const pick = (allowUser: boolean): CutItem | undefined =>
    cut.items
      .filter((i) => i.kind === 'zone' && i.expanded && !reveal.has(i.id) && (allowUser || !isProtected(i.id)))
      .sort((a, b) => b.fileCount - a.fileCount || a.depth - b.depth || (a.id < b.id ? -1 : 1))[0];
  for (let guard = 0; guard < 500 && cut.items.length > cap; guard++) {
    const candidate = pick(false) ?? (cut.items.length > ZONE_LAYOUT.hardNodeBudget ? pick(true) : undefined);
    if (!candidate) break;
    auto.add(candidate.id);
    cut = build(auto);
  }
  return cut;
}

/** Item ids of the zones containing a file, outermost first (what a reveal must expand). */
export function zoneChainOfFile(h: Hierarchy, zoneSet: ZoneSet, fileId: string): string[] {
  const zoneById = new Map(zoneSet.zones.map((z) => [z.id, z]));
  const ids = zoneItemIds(h, zoneSet);
  const chain: string[] = [];
  let cur = zoneSet.zoneOfFile[fileId];
  while (cur) {
    const z = zoneById.get(cur);
    if (!z) break;
    chain.unshift(ids.get(z.id) ?? z.id);
    cur = z.parentId ?? '';
  }
  return chain;
}
