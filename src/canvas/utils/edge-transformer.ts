/**
 * Edges of a `MapView`: sibling links (aggregated, with count and a
 * "imports 12 · calls 3" label) and portal links (stub ↔ inner node).
 * `applyRelationFilter` restricts counts to the visible relation types and
 * drops portals that no longer carry anything — recounting, so the numbers
 * on screen always add up.
 */
import type { Edge, Node } from '@xyflow/react';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { AggregatedLink, CanvasEdgeData, MapView, PortalNodeData, TypeCounts } from '../../contracts/canvas/index.js';
import { arrowMarker, relationColor } from './relation-colors';
import { describeCounts, rankTypeCounts, totalOf } from './relation-labels';

type EdgeLayer = NonNullable<CanvasEdgeData['layer']>;

/** Focus mode: above this many edges, single-relation edges are labelled only when hovered. */
export const FOCUS_LABEL_LIMIT = 36;

/** Bundles get thicker with the number of relations they carry (log scale, capped). */
export const bundleWidth = (count: number): number => Math.min(9, 1.6 + Math.log2(count + 1) * 1.1);

function linkToEdge(link: AggregatedLink, portal: 'in' | 'out' | undefined, relationById?: Map<string, Relation>, layer?: EdgeLayer): Edge<CanvasEdgeData> {
  const ranked = rankTypeCounts(link.typeCounts);
  const dominantType = ranked[0][0];
  const single = link.count === 1 ? relationById?.get(link.relationIds[0]) : undefined;
  const bundle = layer === 'bundle';
  return {
    id: `${bundle ? 'bundle' : 'agg'}:${link.source}->${link.target}`,
    source: link.source,
    target: link.target,
    type: 'relation',
    markerEnd: arrowMarker(relationColor(dominantType)),
    style: { stroke: relationColor(dominantType), ...(portal ? { strokeDasharray: '5 4' } : {}), ...(bundle ? { strokeWidth: bundleWidth(link.count) } : {}) },
    data: {
      kind: link.count === 1 && !bundle ? 'entity-edge' : 'aggregated-edge',
      ...(layer ? { layer } : {}),
      types: ranked.map(([t]) => t),
      dominantType,
      count: link.count,
      typeCounts: link.typeCounts,
      label: describeCounts(link.typeCounts),
      relationIds: link.relationIds,
      relation: single,
      portal,
    },
  };
}

/** All edges of a view, unfiltered (layout input). */
export function buildViewEdges(view: MapView, relationById?: Map<string, Relation>): Edge<CanvasEdgeData>[] {
  const zoned = !!view.cut;
  // Focus mode: the neighbourhood is small, so every link is drawn at card level, at full strength, labelled.
  const layerOf = (l: AggregatedLink): EdgeLayer | undefined => (view.focus ? 'focus' : zoned ? (l.cross ? 'detail' : 'sibling') : undefined);
  const edges = view.links.map((l) => linkToEdge(l, undefined, relationById, layerOf(l)));
  if (view.focus && edges.length > FOCUS_LABEL_LIMIT) for (const e of edges) e.data!.crowded = true;
  for (const b of view.bundles ?? []) edges.push(linkToEdge(b, undefined, relationById, 'bundle'));
  for (const p of view.portals) for (const l of p.links) edges.push(linkToEdge(l, p.direction, relationById, zoned ? 'portal' : undefined));
  return edges;
}

function restrict(counts: TypeCounts, visible: ReadonlySet<string>): TypeCounts {
  const out: TypeCounts = {};
  for (const [t, n] of Object.entries(counts)) if (visible.has(t)) out[t as RelationType] = n;
  return out;
}

/**
 * Keep edges carrying at least one visible relation type, recounted and
 * re-coloured by their most frequent visible type. Portals left without any
 * edge are removed; the rest show the visible count (and how many relations
 * the filter hides).
 */
export function applyRelationFilter(
  nodes: Node[],
  edges: Edge<CanvasEdgeData>[],
  visibleTypes: ReadonlySet<string>,
): { nodes: Node[]; edges: Edge<CanvasEdgeData>[] } {
  const kept: Edge<CanvasEdgeData>[] = [];
  const portalCounts = new Map<string, { counts: TypeCounts; all: number }>();
  for (const e of edges) {
    const data = e.data;
    if (!data?.typeCounts) {
      kept.push(e);
      continue;
    }
    const counts = restrict(data.typeCounts, visibleTypes);
    const count = totalOf(counts);
    if (data.portal) {
      const pid = data.portal === 'in' ? e.source : e.target;
      const acc = portalCounts.get(pid) ?? { counts: {}, all: 0 };
      for (const [t, n] of Object.entries(counts)) acc.counts[t as RelationType] = (acc.counts[t as RelationType] ?? 0) + (n ?? 0);
      acc.all += totalOf(data.typeCounts);
      portalCounts.set(pid, acc);
    }
    if (count === 0) continue;
    const ranked = rankTypeCounts(counts);
    const dominantType = ranked[0][0];
    kept.push({
      ...e,
      markerEnd: arrowMarker(relationColor(dominantType)),
      style: { ...e.style, stroke: relationColor(dominantType), ...(data.layer === 'bundle' ? { strokeWidth: bundleWidth(count) } : {}) },
      data: { ...data, types: ranked.map(([t]) => t), dominantType, count, typeCounts: counts, label: describeCounts(counts), kind: count === 1 && data.layer !== 'bundle' ? 'entity-edge' : 'aggregated-edge' },
    });
  }
  const outNodes: Node[] = [];
  for (const n of nodes) {
    if (n.type !== 'portal') {
      outNodes.push(n);
      continue;
    }
    const acc = portalCounts.get(n.id);
    const count = acc ? totalOf(acc.counts) : 0;
    if (count === 0) continue;
    const data = n.data as PortalNodeData;
    outNodes.push({ ...n, data: { ...data, count, typeCounts: acc!.counts, hiddenByFilter: acc!.all - count } });
  }
  return { nodes: outNodes, edges: kept };
}
