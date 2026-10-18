/** Zone statistics: aggregated from the member files (so overrides that move files stay consistent). */
import type { Hierarchy, HierarchyStats } from '../../contracts/hierarchy.js';

export interface StatAcc {
  files: number;
  symbols: number;
  lines: number;
  qualityWeighted: number;
  qualitySymbols: number;
  churn?: number;
  hotspot?: number;
  folders: Set<string>;
}

export const emptyAcc = (): StatAcc => ({ files: 0, symbols: 0, lines: 0, qualityWeighted: 0, qualitySymbols: 0, folders: new Set() });

/** Fold one file into `acc`; folder / package ancestors below the `stop` nodes count as folders of the zone. */
export function addFile(h: Hierarchy, acc: StatAcc, fileId: string, stop: ReadonlySet<string>): void {
  const n = h.nodes.get(fileId);
  if (!n) return;
  acc.files += 1;
  acc.symbols += n.stats.symbols;
  acc.lines += n.stats.lines;
  if (n.stats.quality !== undefined && n.stats.symbols > 0) {
    acc.qualityWeighted += n.stats.quality * n.stats.symbols;
    acc.qualitySymbols += n.stats.symbols;
  }
  if (n.stats.churn !== undefined) acc.churn = Math.max(acc.churn ?? 0, n.stats.churn);
  if (n.stats.hotspot !== undefined) acc.hotspot = Math.max(acc.hotspot ?? 0, n.stats.hotspot);
  for (let p = n.parentId ? h.nodes.get(n.parentId) : undefined; p && !stop.has(p.id) && p.kind !== 'project'; p = p.parentId ? h.nodes.get(p.parentId) : undefined) {
    if (p.kind === 'folder' || p.kind === 'package') acc.folders.add(p.id);
  }
}

export function mergeInto(into: StatAcc, from: StatAcc, fromAnchor: string | undefined): void {
  into.files += from.files;
  into.symbols += from.symbols;
  into.lines += from.lines;
  into.qualityWeighted += from.qualityWeighted;
  into.qualitySymbols += from.qualitySymbols;
  if (from.churn !== undefined) into.churn = Math.max(into.churn ?? 0, from.churn);
  if (from.hotspot !== undefined) into.hotspot = Math.max(into.hotspot ?? 0, from.hotspot);
  for (const f of from.folders) into.folders.add(f);
  if (fromAnchor) into.folders.add(fromAnchor);
}

export function finishStats(acc: StatAcc): HierarchyStats {
  const s: HierarchyStats = { files: acc.files, folders: acc.folders.size, symbols: acc.symbols, lines: acc.lines };
  if (acc.qualitySymbols > 0) s.quality = Math.round(acc.qualityWeighted / acc.qualitySymbols);
  if (acc.churn !== undefined) s.churn = acc.churn;
  if (acc.hotspot !== undefined) s.hotspot = acc.hotspot;
  return s;
}
