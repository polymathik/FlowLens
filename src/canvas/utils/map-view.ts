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
import type { AggregatedLink, MapView, MapViewOptions } from '../../contracts/canvas/index.js';
import { commonPrefixLength, resolveRef } from '../../analysis/hierarchy/index.js';
import { buildPortals, baseChain, DEFAULT_PORTAL_CAP, type PortalHit } from './portals';
import { addToLink, emptyAccounting, isZoneContainer, pathOf, resolveContainer, scopeNodeId, sortedLinks, visibleChildren } from './view-scope';
import { computeZoneView } from './zone-view';

export { resolveContainer, scopeNodeId, visibleChildren };

type Slot = { t: 'inner'; id: string } | { t: 'hidden' } | { t: 'out'; chain: string[] };

export function computeMapView(h: Hierarchy, relations: Relation[], drillPath: string[], options: MapViewOptions): MapView {
  const containerId = resolveContainer(h, drillPath);
  if (options.zones && isZoneContainer(h, containerId)) return computeZoneView(h, relations, containerId, options, options.zones);
  const containerPath = pathOf(h, containerId);
  const k = containerPath.length;
  const kids = visibleChildren(h, containerId, options.showLockfiles);
  const leaf = kids.length === 0 && containerId !== PROJECT_NODE_ID && (h.nodes.get(containerId)?.childIds.length ?? 0) === 0;
  const keep = new Set(kids);
  const scopeId = scopeNodeId(containerId);
  const acc = emptyAccounting();
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
        addToLink(links, a.id, b.id, r);
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
    links: sortedLinks(links),
    portals,
    accounting: acc,
  };
}

export { baseChain };
