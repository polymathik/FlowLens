/**
 * What each item of the map's cut stands for, in file paths: a file card is
 * its own path; a zone (frame or card) is every file card below it. Also the
 * top-level item of every file (the zone the growth chart books it to).
 * Pure; built once per cut.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { CutItem, MapCut } from '../../contracts/canvas/index.js';

export interface ItemMap {
  /** Card paths below an item (a file item: itself). */
  files: Map<string, string[]>;
  /** File items: their path. */
  pathOfItem: Map<string, string>;
  /** Card path → the item that stands for it on the map (its own card, or the collapsed zone holding it). */
  atomOf: Map<string, string>;
  /** Card path → id of the top-level item holding it. */
  topOf: Map<string, string>;
  /** Top-level items (zones, or loose file cards), in cut order. */
  tops: CutItem[];
  byId: Map<string, CutItem>;
}

export function buildItemMap(cut: MapCut, h: Hierarchy): ItemMap {
  const byId = new Map(cut.items.map((i) => [i.id, i]));
  const pathOfItem = new Map<string, string>();
  const collapsedFiles = new Map<string, string[]>();
  for (const [fileId, atom] of Object.entries(cut.atomOfFile)) {
    const path = h.nodes.get(fileId)?.path;
    if (path === undefined) continue;
    if (fileId === atom) pathOfItem.set(atom, path);
    else (collapsedFiles.get(atom) ?? collapsedFiles.set(atom, []).get(atom)!).push(path);
  }
  const atomOf = new Map<string, string>();
  for (const [fileId, atom] of Object.entries(cut.atomOfFile)) {
    const path = h.nodes.get(fileId)?.path;
    if (path !== undefined) atomOf.set(path, atom);
  }
  const files = new Map<string, string[]>();
  const collect = (item: CutItem): string[] => {
    const known = files.get(item.id);
    if (known) return known;
    let out: string[];
    if (item.kind === 'file') out = pathOfItem.has(item.id) ? [pathOfItem.get(item.id)!] : [];
    else if (!item.expanded) out = collapsedFiles.get(item.id) ?? [];
    else out = item.childIds.flatMap((c) => (byId.has(c) ? collect(byId.get(c)!) : []));
    files.set(item.id, out);
    return out;
  };
  for (const item of cut.items) collect(item);
  const tops = cut.items.filter((i) => i.parentId === null);
  const topOf = new Map<string, string>();
  for (const top of tops) for (const p of files.get(top.id) ?? []) topOf.set(p, top.id);
  return { files, pathOfItem, atomOf, topOf, tops, byId };
}

/** An item and its ancestors, innermost first. */
export function chainOf(map: Pick<ItemMap, 'byId'>, itemId: string): string[] {
  const chain: string[] = [];
  for (let id: string | null | undefined = itemId; id && chain.length < 16; id = map.byId.get(id)?.parentId) chain.push(id);
  return chain;
}
