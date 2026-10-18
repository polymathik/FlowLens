/** Recursive statistics for hierarchy nodes (post-order accumulation). */
import type { HierarchyNode, HierarchyStats } from '../../contracts/hierarchy.js';

export interface MetricAcc {
  qSum: number;
  qCount: number;
  churn?: number;
  hotspot?: number;
}

export const emptyStats = (): HierarchyStats => ({ files: 0, folders: 0, symbols: 0, lines: 0 });
export const emptyAcc = (): MetricAcc => ({ qSum: 0, qCount: 0 });

export function mergeAcc(into: MetricAcc, from: MetricAcc): void {
  into.qSum += from.qSum;
  into.qCount += from.qCount;
  if (from.churn !== undefined) into.churn = Math.max(into.churn ?? 0, from.churn);
  if (from.hotspot !== undefined) into.hotspot = Math.max(into.hotspot ?? 0, from.hotspot);
}

export function finishStats(stats: HierarchyStats, acc: MetricAcc): void {
  if (acc.qCount > 0) stats.quality = Math.round(acc.qSum / acc.qCount);
  if (acc.churn !== undefined) stats.churn = acc.churn;
  if (acc.hotspot !== undefined) stats.hotspot = acc.hotspot;
}

/** Size used to rank "top files": symbol count, then lines, then name. */
export function fileWeight(n: HierarchyNode): number {
  return n.stats.symbols * 1_000_000 + n.stats.lines;
}

/** Merge candidate file ids into the best `limit` by weight (stable by id). */
export function topFiles(nodes: Map<string, HierarchyNode>, ids: string[], limit = 3): string[] {
  return [...new Set(ids)]
    .sort((a, b) => fileWeight(nodes.get(b)!) - fileWeight(nodes.get(a)!) || (a < b ? -1 : 1))
    .slice(0, limit);
}
