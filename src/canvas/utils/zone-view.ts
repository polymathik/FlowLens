/**
 * Zone view model (Map v2 M2): for a container that holds files, the CUT of
 * its zone tree (frames, cards), the links between the visible cards and
 * zones, frame-level bundles and portals. Pure; same exactness contract as
 * the flat view (`considered = edges + portalIn + portalOut + internal + hidden`).
 *
 * Every relation is attached to the visible *atom* of each end — the file's
 * card, or its outermost collapsed zone. Between two different atoms it
 * becomes one link at card level; when the atoms sit under different frames
 * the link is `cross` (dimmed) and the relation also lands in exactly one
 * frame-level bundle, drawn between the two highest frames that differ.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Relation } from '../../contracts/relations.js';
import type { AggregatedLink, MapView, MapViewOptions, ZoneViewOptions } from '../../contracts/canvas/index.js';
import { commonPrefixLength, resolveRef } from '../../analysis/hierarchy/index.js';
import { buildPortals, DEFAULT_PORTAL_CAP, type PortalHit } from './portals';
import { addToLink, emptyAccounting, pathOf, scopeNodeId, sortedLinks, visibleFiles } from './view-scope';
import { buildCut, zoneChainOfFile } from './zone-cut';
import { getZones } from './zones-adapter';

type Slot = { t: 'inner'; id: string } | { t: 'hidden' } | { t: 'out'; chain: string[] };

export function computeZoneView(h: Hierarchy, relations: Relation[], containerId: string, options: MapViewOptions, zo: ZoneViewOptions): MapView {
  const files = visibleFiles(h, containerId, options.showLockfiles);
  let mode = zo.mode;
  let zoneSet = getZones({ mode, hierarchy: h, scopeId: containerId, overrides: zo.overrides });
  if (zoneSet.zones.length === 0 && mode !== 'folders') {
    // The requested grouping finds nothing here (e.g. no package boundary inside a package): group by folders.
    const byFolders = getZones({ mode: 'folders', hierarchy: h, scopeId: containerId, overrides: zo.overrides });
    if (byFolders.zones.length > 0) {
      mode = 'folders';
      zoneSet = byFolders;
    }
  }
  const reveal = [...(zo.reveal ?? [])];
  for (const ref of zo.revealRefs ?? []) {
    const node = resolveRef(h, ref);
    const file = node && pathOf(h, node).find((id) => h.nodes.get(id)?.kind === 'file');
    if (file) reveal.push(...zoneChainOfFile(h, zoneSet, file));
  }
  const cut = buildCut({ h, zoneSet, containerId, files, mode, options: { ...zo, reveal } });

  const itemById = new Map(cut.items.map((i) => [i.id, i]));
  /** Enclosing frames of an item, outermost first. */
  const framesOf = (id: string): string[] => {
    const out: string[] = [];
    for (let p = itemById.get(id)?.parentId; p; p = itemById.get(p)?.parentId) out.unshift(p);
    return out;
  };
  /** The two highest items that differ below the lowest common frame. */
  const bundleEnds = (a: string, b: string): [string, string] => {
    const fa = framesOf(a);
    const fb = framesOf(b);
    const c = commonPrefixLength(fa, fb);
    return [fa[c] ?? a, fb[c] ?? b];
  };
  const topOf = (id: string): string => framesOf(id)[0] ?? id;

  const containerPath = pathOf(h, containerId);
  const k = containerPath.length;
  const scopeId = scopeNodeId(containerId);
  let scopeUsed = false;
  const locate = (nodeId: string): Slot => {
    const p = pathOf(h, nodeId);
    if (commonPrefixLength(p, containerPath) < k) return { t: 'out', chain: p.slice(commonPrefixLength(p, containerPath)) };
    if (p.length === k) {
      scopeUsed = true;
      return { t: 'inner', id: scopeId };
    }
    for (let i = k; i < p.length; i++) {
      if (h.nodes.get(p[i])?.kind === 'file') {
        const atom = cut.atomOfFile[p[i]];
        return atom ? { t: 'inner', id: atom } : { t: 'hidden' };
      }
    }
    for (let i = p.length - 1; i >= k; i--) if (itemById.has(p[i])) return { t: 'inner', id: p[i] };
    return { t: 'hidden' };
  };

  const acc = emptyAccounting();
  const links = new Map<string, AggregatedLink>();
  const bundles = new Map<string, AggregatedLink>();
  const hits: PortalHit[] = [];
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
        const [x, y] = bundleEnds(a.id, b.id);
        const cross = x !== a.id || y !== b.id;
        addToLink(links, a.id, b.id, r, cross);
        if (cross) addToLink(bundles, x, y, r);
      }
    } else if (a.t === 'inner' && b.t === 'out') {
      acc.portalOut++;
      hits.push({ direction: 'out', chain: b.chain, inner: topOf(a.id), relation: r });
    } else if (a.t === 'out' && b.t === 'inner') {
      acc.portalIn++;
      hits.push({ direction: 'in', chain: a.chain, inner: topOf(b.id), relation: r });
    }
  }

  return {
    containerId,
    nodeIds: [...cut.items.map((i) => i.id), ...(scopeUsed ? [scopeId] : [])],
    leaf: false,
    scopeId: scopeUsed ? scopeId : undefined,
    links: sortedLinks(links),
    bundles: sortedLinks(bundles),
    portals: buildPortals(h, hits, options.portalCap ?? DEFAULT_PORTAL_CAP),
    accounting: acc,
    cut,
    zoning: { mode, requested: zo.mode, zoneSet },
  };
}
