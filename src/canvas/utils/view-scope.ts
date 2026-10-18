/**
 * Shared helpers of the view models (flat M1 view and zone view): where a
 * hierarchy node sits relative to the open container, which files and
 * children are visible, and the accounting scaffolding.
 */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode } from '../../contracts/hierarchy.js';
import type { AggregatedLink, RelationAccounting } from '../../contracts/canvas/index.js';
import type { Relation } from '../../contracts/relations.js';
import { pathTo } from '../../analysis/hierarchy/index.js';

export const scopeNodeId = (containerId: string): string => `scope:${containerId}`;

const pathCache = new WeakMap<Hierarchy, Map<string, string[]>>();
/** Memoised root-excluded path of a node. */
export function pathOf(h: Hierarchy, id: string): string[] {
  let cache = pathCache.get(h);
  if (!cache) pathCache.set(h, (cache = new Map()));
  let p = cache.get(id);
  if (!p) cache.set(id, (p = pathTo(h, id)));
  return p;
}

/** Last drill-path entry that still exists (a re-index can remove nodes); the project otherwise. */
export function resolveContainer(h: Hierarchy, drillPath: string[]): string {
  for (let i = drillPath.length - 1; i >= 0; i--) if (h.nodes.has(drillPath[i])) return drillPath[i];
  return PROJECT_NODE_ID;
}

export const lockfileOnly = (h: Hierarchy, n: HierarchyNode): boolean =>
  n.kind === 'config' && n.childIds.every((c) => h.nodes.get(c)?.role === 'lockfile');

/** Children that appear in the view; lockfiles (and a Config group holding only lockfiles) are optional. */
export function visibleChildren(h: Hierarchy, containerId: string, showLockfiles: boolean): string[] {
  const node = h.nodes.get(containerId);
  if (!node) return [];
  return node.childIds.filter((id) => {
    const n = h.nodes.get(id)!;
    if (showLockfiles) return true;
    return n.role !== 'lockfile' && !lockfileOnly(h, n);
  });
}

/** File nodes below a container that appear as cards (lockfiles optional). */
export function visibleFiles(h: Hierarchy, containerId: string, showLockfiles: boolean): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of visibleChildren(h, id, showLockfiles)) {
      const n = h.nodes.get(c)!;
      if (n.kind === 'file') out.push(c);
      else if (n.kind === 'folder' || n.kind === 'package' || n.kind === 'config') walk(c);
    }
  };
  walk(containerId);
  return out;
}

/** The zone renderer applies to containers that hold files below them (not to a file, class or symbol). */
export function isZoneContainer(h: Hierarchy, containerId: string): boolean {
  const n = h.nodes.get(containerId);
  return !!n && (n.kind === 'project' || n.kind === 'package' || n.kind === 'folder' || n.kind === 'config') && n.childIds.length > 0;
}

export const emptyAccounting = (): RelationAccounting => ({ considered: 0, edges: 0, portalIn: 0, portalOut: 0, internal: 0, hidden: 0, unknownEndpoint: 0 });

export function bump(counts: AggregatedLink['typeCounts'], type: Relation['type']): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

/** Add one relation to the link `source → target`, creating it on first use. */
export function addToLink(links: Map<string, AggregatedLink>, source: string, target: string, r: Relation, cross?: boolean): void {
  const key = `${source}->${target}`;
  let link = links.get(key);
  if (!link) links.set(key, (link = { source, target, count: 0, typeCounts: {}, relationIds: [], ...(cross ? { cross: true } : {}) }));
  link.count++;
  bump(link.typeCounts, r.type);
  link.relationIds.push(r.id);
}

export const sortedLinks = (links: Map<string, AggregatedLink>): AggregatedLink[] =>
  [...links.values()].sort((x, y) => (x.source + x.target < y.source + y.target ? -1 : 1));
