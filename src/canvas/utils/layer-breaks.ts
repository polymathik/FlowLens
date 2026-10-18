/**
 * Layers view: architecture rule breaks (the `/violations` data) drawn on the
 * zone map.
 *
 *  - `computeLayerBreaks`  which relations break a rule and which cards / frames they start in
 *  - `markLayerBreaks`     links that carry broken relations become red dashed `violation` edges
 *                          with a count; a link that also carries allowed relations is split in two
 *                          (nothing is double counted: the counts of the two edges add up to the original)
 *  - `decorateBreaks`      red marker on the cards (overlay look) and the count on the frames' chips
 *  - `bulgeStackEdges`     links between non-adjacent layers leave on the right and pass around the
 *                          layers in between, instead of cutting through them
 */
import type { Edge, Node } from '@xyflow/react';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import type { CanvasEdgeData, MapCut } from '../../contracts/canvas/index.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import { chainOf, resolveRef } from '../../analysis/hierarchy/index.js';
import { violationNodeStyle } from '../overlays/apply-overlay';
import { PROBLEM_COLOR, arrowMarker } from './relation-colors';
import { bundleWidth } from './edge-transformer';
import { describeCounts } from './relation-labels';

export interface LayerBreaks {
  /** Relation ids that break a rule. */
  relationIds: ReadonlySet<string>;
  /** Relation id → the rule it breaks (first one when several). */
  ruleOf: ReadonlyMap<string, string>;
  /** Card / frame item id → rule breaks that start in it (frames count everything below). */
  perItem: ReadonlyMap<string, number>;
  total: number;
}

export const NO_BREAKS: LayerBreaks = { relationIds: new Set(), ruleOf: new Map(), perItem: new Map(), total: 0 };

const relationIndexCache = new WeakMap<Relation[], Map<string, string>>();
const keyOf = (from: string, to: string, type: string): string => `${from}\u0000${to}\u0000${type}`;

/** `from|to|type` → relation id (a relation is unique per that triple). */
function relationIndex(relations: Relation[]): Map<string, string> {
  let idx = relationIndexCache.get(relations);
  if (!idx) {
    idx = new Map();
    for (const r of relations) idx.set(keyOf(r.from, r.to, r.type), r.id);
    relationIndexCache.set(relations, idx);
  }
  return idx;
}

export function computeLayerBreaks(violations: ArchitectureViolation[], relations: Relation[], h: Hierarchy, cut: MapCut | undefined): LayerBreaks {
  if (violations.length === 0) return NO_BREAKS;
  const idx = relationIndex(relations);
  const parentOf = new Map((cut?.items ?? []).map((i) => [i.id, i.parentId]));
  const relationIds = new Set<string>();
  const ruleOf = new Map<string, string>();
  const perItem = new Map<string, number>();
  for (const v of violations) {
    const rid = idx.get(keyOf(v.entity_from, v.entity_to, v.relation_type));
    if (rid) {
      relationIds.add(rid);
      if (!ruleOf.has(rid)) ruleOf.set(rid, v.rule_text ?? `${v.layer_from} must not access ${v.layer_to}`);
    }
    const node = resolveRef(h, v.entity_from);
    const file = node && chainOf(h, node).find((id) => h.nodes.get(id)?.kind === 'file');
    for (let item: string | null | undefined = file ? cut?.atomOfFile[file] : undefined; item; item = parentOf.get(item)) {
      perItem.set(item, (perItem.get(item) ?? 0) + 1);
    }
  }
  return { relationIds, ruleOf, perItem, total: violations.length };
}

const plural = (n: number): string => `${n} rule break${n === 1 ? '' : 's'}`;

function countTypes(ids: string[], relationById: Map<string, Relation>): Partial<Record<RelationType, number>> {
  const out: Partial<Record<RelationType, number>> = {};
  for (const id of ids) {
    const t = relationById.get(id)?.type;
    if (t) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

export interface MarkContext {
  relationById: Map<string, Relation>;
  visibleTypes: ReadonlySet<string>;
}

export function markLayerBreaks(edges: Edge<CanvasEdgeData>[], breaks: LayerBreaks, ctx: MarkContext): Edge<CanvasEdgeData>[] {
  if (breaks.relationIds.size === 0) return edges;
  const out: Edge<CanvasEdgeData>[] = [];
  for (const e of edges) {
    const data = e.data;
    if (!data?.relationIds || data.portal || data.is_violation) {
      out.push(e);
      continue;
    }
    const broken = data.relationIds.filter((id) => breaks.relationIds.has(id) && ctx.visibleTypes.has(ctx.relationById.get(id)?.type ?? ''));
    if (broken.length === 0) {
      out.push(e);
      continue;
    }
    const split = broken.length < data.count;
    const width = e.data?.layer === 'bundle' ? bundleWidth(broken.length) : Math.min(5, 2.2 + broken.length * 0.2);
    out.push({
      ...e,
      id: split ? `rule:${e.id}` : e.id,
      type: 'violation',
      markerEnd: arrowMarker(PROBLEM_COLOR),
      style: { ...e.style, stroke: PROBLEM_COLOR, strokeWidth: width },
      data: {
        ...data,
        kind: 'aggregated-edge',
        count: broken.length,
        typeCounts: countTypes(broken, ctx.relationById),
        relationIds: broken,
        is_violation: true,
        breakLabel: plural(broken.length),
        ruleText: breaks.ruleOf.get(broken[0]),
        ...(split ? { curve: 0.7 } : {}),
      },
    });
    if (split) {
      const brokenSet = new Set(broken);
      const typeCounts = { ...data.typeCounts };
      for (const [t, n] of Object.entries(countTypes(broken, ctx.relationById))) typeCounts[t as RelationType] = Math.max(0, (typeCounts[t as RelationType] ?? 0) - (n ?? 0));
      out.push({ ...e, data: { ...data, count: data.count - broken.length, typeCounts, label: describeCounts(typeCounts), relationIds: data.relationIds.filter((id) => !brokenSet.has(id)) } });
    }
  }
  return out;
}

/** Red markers on cards (the overlay look) and break counts on frame chips; nodes already decorated by an overlay keep it. */
export function decorateBreaks(nodes: Node[], breaks: LayerBreaks): Node[] {
  if (breaks.perItem.size === 0) return nodes;
  return nodes.map((n) => {
    const count = breaks.perItem.get(n.id);
    if (!count) return n;
    const data = n.data as { overlay?: unknown };
    if (n.type === 'zone') return { ...n, data: { ...n.data, ruleBreaks: count } };
    if (n.type === 'file') return { ...n, data: { ...n.data, ruleBreaks: count, ...(data.overlay ? {} : { overlay: violationNodeStyle(count) }) } };
    return n;
  });
}

const BULGE_GAP = 38;
const BULGE_LANE = 26;

/**
 * Edges between top-level boxes that are not neighbours in the stack get `bulgeX`: the x they swing out to, to the
 * right of every top-level box, one lane further out per skipped layer. Neighbours keep the plain curve.
 */
export function bulgeStackEdges(edges: Edge<CanvasEdgeData>[], nodes: Node[], topIds: string[]): Edge<CanvasEdgeData>[] {
  const rank = new Map(topIds.map((id, i) => [id, i]));
  const top = nodes.filter((n) => rank.has(n.id) && !n.hidden);
  if (top.length < 3) return edges;
  const right = Math.max(...top.map((n) => n.position.x + Number(n.width ?? n.style?.width ?? 0)));
  return edges.map((e) => {
    const a = rank.get(e.source);
    const b = rank.get(e.target);
    if (a === undefined || b === undefined || Math.abs(a - b) < 2) return e;
    const lane = Math.abs(a - b) - 1;
    return { ...e, data: { ...e.data!, bulgeX: right + BULGE_GAP + BULGE_LANE * (lane - 1) } };
  });
}
