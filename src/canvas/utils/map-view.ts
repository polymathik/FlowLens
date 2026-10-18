/**
 * Map view model: for one open container of the hierarchy, the nodes to
 * show (its children), the links between them, and portals for every link
 * that crosses the container boundary. Pure; see `contracts/canvas/map-view.ts`
 * for the exactness contract (`RelationAccounting`).
 *
 *   project                       → top-level packages / folders / files / Config
 *   package | folder              → its children
 *   file                          → its top-level symbols (+ a scope node for the file's own imports)
 *   class                         → its members
 *   leaf (function, empty file)   → the node itself, with portals for callers / callees
 */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode } from '../../contracts/hierarchy.js';
import type { Relation } from '../../contracts/relations.js';
import type { AggregatedLink, MapView, MapViewOptions, RelationAccounting } from '../../contracts/canvas/index.js';
import { commonPrefixLength, pathTo, resolveRef } from '../../analysis/hierarchy/index.js';
import { buildPortals, baseChain, DEFAULT_PORTAL_CAP, type PortalHit } from './portals';

export const scopeNodeId = (containerId: string): string => `scope:${containerId}`;

const pathCache = new WeakMap<Hierarchy, Map<string, string[]>>();
function pathOf(h: Hierarchy, id: string): string[] {
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

const lockfileOnly = (h: Hierarchy, n: HierarchyNode): boolean =>
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

type Slot = { t: 'inner'; id: string } | { t: 'hidden' } | { t: 'out'; chain: string[] };

function bump(counts: AggregatedLink['typeCounts'], type: Relation['type']): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

export function computeMapView(h: Hierarchy, relations: Relation[], drillPath: string[], options: MapViewOptions): MapView {
  const containerId = resolveContainer(h, drillPath);
  const containerPath = pathOf(h, containerId);
  const k = containerPath.length;
  const kids = visibleChildren(h, containerId, options.showLockfiles);
  const leaf = kids.length === 0 && containerId !== PROJECT_NODE_ID && (h.nodes.get(containerId)?.childIds.length ?? 0) === 0;
  const keep = new Set(kids);
  const scopeId = scopeNodeId(containerId);
  const acc: RelationAccounting = { considered: 0, edges: 0, portalIn: 0, portalOut: 0, internal: 0, hidden: 0, unknownEndpoint: 0 };
  const links = new Map<string, AggregatedLink>();
  const hits: PortalHit[] = [];
  let scopeUsed = false;

  const locate = (nodeId: string): Slot => {
    const p = pathOf(h, nodeId);
    if (commonPrefixLength(p, containerPath) === k) {
      if (leaf) return { t: 'inner', id: containerId };
      if (p.length === k) {
        scopeUsed = true;
        return { t: 'inner', id: scopeId };
      }
      return keep.has(p[k]) ? { t: 'inner', id: p[k] } : { t: 'hidden' };
    }
    return { t: 'out', chain: p.slice(commonPrefixLength(p, containerPath)) };
  };

  for (const r of relations) {
    if (r.type === 'contain' || !r.to) continue;
    const from = resolveRef(h, r.from);
    const to = resolveRef(h, r.to);
    if (!from || !to) {
      acc.unknownEndpoint++;
      continue;
    }
    const a = locate(from);
    const b = locate(to);
    if (a.t === 'out' && b.t === 'out') continue;
    acc.considered++;
    if (a.t === 'hidden' || b.t === 'hidden') acc.hidden++;
    else if (a.t === 'inner' && b.t === 'inner') {
      if (a.id === b.id) acc.internal++;
      else {
        acc.edges++;
        const key = `${a.id}->${b.id}`;
        let link = links.get(key);
        if (!link) links.set(key, (link = { source: a.id, target: b.id, count: 0, typeCounts: {}, relationIds: [] }));
        link.count++;
        bump(link.typeCounts, r.type);
        link.relationIds.push(r.id);
      }
    } else if (a.t === 'inner' && b.t === 'out') {
      acc.portalOut++;
      hits.push({ direction: 'out', chain: b.chain, inner: a.id, relation: r });
    } else if (a.t === 'out' && b.t === 'inner') {
      acc.portalIn++;
      hits.push({ direction: 'in', chain: a.chain, inner: b.id, relation: r });
    }
  }

  const portals = buildPortals(h, hits, options.portalCap ?? DEFAULT_PORTAL_CAP);
  return {
    containerId,
    nodeIds: leaf ? [containerId] : scopeUsed ? [...kids, scopeId] : kids,
    leaf,
    scopeId: scopeUsed && !leaf ? scopeId : undefined,
    links: [...links.values()].sort((x, y) => (x.source + x.target < y.source + y.target ? -1 : 1)),
    portals,
    accounting: acc,
  };
}

export { baseChain };
