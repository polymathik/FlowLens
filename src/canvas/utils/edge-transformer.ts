/**
 * Transforms Relation[] into React Flow Edge[] for the *currently visible*
 * node set.
 *
 * Each relation endpoint is resolved to its deepest visible ancestor
 * (`GraphIndex.resolveVisible`): a symbol, its file, module or system.
 * Relations that land on the same (source, target) pair are aggregated into
 * one edge carrying every relation type (`types`, most frequent first) and a
 * count. This handles every drill level, including mixed views (e.g. the
 * files of one module next to its sibling modules).
 *
 * Self-loops (both endpoints inside the same visible node) are dropped.
 */
import type { Edge } from '@xyflow/react';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';
import type { GraphIndex } from './graph-index';
import { arrowMarker, relationColor } from './relation-colors';

interface PairAcc {
  source: string;
  target: string;
  count: number;
  types: Map<RelationType, number>;
  first: Relation;
}

/** Sort types by frequency (desc), then name, for stable output. */
function rankTypes(types: Map<RelationType, number>): RelationType[] {
  return [...types.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

export function transformRelationsToEdges(
  relations: Relation[],
  visibleIds: ReadonlySet<string>,
  index: GraphIndex,
): Edge<CanvasEdgeData>[] {
  const pairs = new Map<string, PairAcc>();

  for (const rel of relations) {
    const source = index.resolveVisible(rel.from, visibleIds);
    if (!source) continue;
    const target = index.resolveVisible(rel.to, visibleIds);
    if (!target || target === source) continue;
    const key = `${source}->${target}`;
    const acc = pairs.get(key);
    if (acc) {
      acc.count++;
      acc.types.set(rel.type, (acc.types.get(rel.type) ?? 0) + 1);
    } else {
      pairs.set(key, {
        source,
        target,
        count: 1,
        types: new Map([[rel.type, 1]]),
        first: rel,
      });
    }
  }

  const edges: Edge<CanvasEdgeData>[] = [];
  for (const [key, acc] of pairs) {
    const types = rankTypes(acc.types);
    const dominantType = types[0];
    const direct =
      acc.count === 1 && acc.source === acc.first.from && acc.target === acc.first.to;
    edges.push({
      id: direct ? acc.first.id : `agg:${key}`,
      source: acc.source,
      target: acc.target,
      type: 'relation',
      markerEnd: arrowMarker(relationColor(dominantType)),
      style: { stroke: relationColor(dominantType) },
      data: {
        kind: direct ? 'entity-edge' : 'aggregated-edge',
        types,
        dominantType,
        count: acc.count,
        relation: direct ? acc.first : undefined,
      },
    });
  }
  return edges;
}

/**
 * Keep edges that carry at least one visible relation type. Checks every
 * aggregated type, not just the dominant one; when the dominant type is
 * hidden the edge is re-coloured by its most frequent *visible* type.
 */
export function filterEdgesByRelationType(
  edges: Edge<CanvasEdgeData>[],
  visibleTypes: ReadonlySet<string>,
): Edge<CanvasEdgeData>[] {
  const out: Edge<CanvasEdgeData>[] = [];
  for (const e of edges) {
    const data = e.data;
    if (!data || data.types.length === 0) {
      out.push(e);
      continue;
    }
    const shown = data.types.find((t) => visibleTypes.has(t));
    if (!shown) continue;
    if (shown === data.dominantType) {
      out.push(e);
      continue;
    }
    out.push({
      ...e,
      markerEnd: arrowMarker(relationColor(shown)),
      style: { ...e.style, stroke: relationColor(shown) },
      data: { ...data, dominantType: shown },
    });
  }
  return out;
}
