/**
 * Overlay logic — pure functions that decorate the *visible* nodes and edges
 * for the active overlay. Node decoration goes into `data.overlay`
 * (contract `NodeOverlayStyle`) and is rendered by the node components;
 * edges in cycles / rule breaks switch to the registered `cycle` /
 * `violation` edge types.
 */
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, NodeOverlayStyle, OverlayType } from '../../contracts/canvas/index.js';
import type { GraphIndex } from '../utils/graph-index';
import type { OverlayExtraData } from './types';
import { churnColor, hotspotSize, qualityColor, withAlpha } from '../utils/color-scales';
import { PROBLEM_COLOR, arrowMarker } from '../utils/relation-colors';
import { isCycleEdge, resolveCycles, resolveDiff, resolveViolations } from './problem-sets';

export const DIFF_COLORS: Record<string, string> = {
  added: '#16a34a',
  removed: '#dc2626',
  modified: '#ca8a04',
  visibility: '#d97706',
  parameter_added: '#dc2626',
  parameter_removed: '#dc2626',
  type_changed: '#dc2626',
  return_changed: '#dc2626',
};

const MUTED: NodeOverlayStyle = { tag: 'none', fill: '#f8fafc', stroke: '#e2e8f0', muted: true };

type Data = Record<string, unknown>;
const num = (n: Node, key: string) => (n.data as Data)[key] as number | undefined;

function decorate(nodes: Node[], fn: (n: Node) => NodeOverlayStyle | undefined): Node[] {
  return nodes.map((n) => {
    const overlay = fn(n);
    return overlay ? { ...n, data: { ...n.data, overlay } } : n;
  });
}

function maxOf(nodes: Node[], key: string): number {
  let max = 0;
  for (const n of nodes) max = Math.max(max, num(n, key) ?? 0);
  return max;
}

export function applyOverlay(
  nodes: Node[],
  overlay: OverlayType | null,
  extra: OverlayExtraData,
  index: GraphIndex,
): Node[] {
  if (!overlay) return nodes;
  const visibleIds = new Set(nodes.map((n) => n.id));

  switch (overlay) {
    case 'complexity-heatmap':
      return decorate(nodes, (n) => {
        const q = num(n, 'qualityScore');
        if (q === undefined) return { ...MUTED, tag: 'complexity' };
        const c = qualityColor(q);
        return { tag: 'complexity', fill: withAlpha(c, 0.16), stroke: c, strokeWidth: 2 };
      });

    case 'churn-heatmap': {
      const max = maxOf(nodes, 'churnRate');
      return decorate(nodes, (n) => {
        const rate = num(n, 'churnRate');
        if (!rate) return { ...MUTED, tag: 'churn' };
        const c = churnColor(rate, max);
        return { tag: 'churn', fill: withAlpha(c, 0.18), stroke: c, strokeWidth: 2.5 };
      });
    }

    case 'hotspot': {
      const max = maxOf(nodes, 'hotspotScore');
      return decorate(nodes, (n) => {
        const score = num(n, 'hotspotScore');
        if (!score) return { ...MUTED, tag: 'hotspot' };
        const ratio = max > 0 ? score / max : 0;
        const c = churnColor(score, max);
        return {
          tag: 'hotspot',
          fill: withAlpha(c, 0.18),
          stroke: c,
          strokeWidth: 2.5,
          scale: hotspotSize(score, max),
          badge: ratio >= 0.66 ? 'hotspot' : undefined,
        };
      });
    }

    case 'cycles': {
      const sets = resolveCycles(extra.cycles, index, visibleIds);
      return decorate(nodes, (n) => {
        const count = sets.members.get(n.id);
        if (!count) return { ...MUTED, tag: 'cycles' };
        return {
          tag: 'cycles',
          stroke: PROBLEM_COLOR,
          strokeStyle: 'dashed',
          strokeWidth: 2.5,
          fill: withAlpha(PROBLEM_COLOR, 0.08),
          badge: count > 1 ? `${count} cycles` : 'in a cycle',
        };
      });
    }

    case 'architecture-violations': {
      const sets = resolveViolations(extra.violations, index, visibleIds);
      return decorate(nodes, (n) => {
        const count = sets.members.get(n.id);
        if (!count) return { ...MUTED, tag: 'violations' };
        return {
          tag: 'violations',
          stroke: PROBLEM_COLOR,
          strokeWidth: 2.5,
          fill: withAlpha(PROBLEM_COLOR, 0.08),
          badge: count > 1 ? `${count} rule breaks` : '1 rule break',
        };
      });
    }

    case 'interface-diff': {
      const changes = resolveDiff(extra.diffChanges, index, visibleIds);
      return decorate(nodes, (n) => {
        const change = changes.get(n.id);
        if (!change) return { ...MUTED, tag: 'diff' };
        const c = DIFF_COLORS[change] ?? '#94a3b8';
        return { tag: 'diff', stroke: c, strokeWidth: 2.5, fill: withAlpha(c, 0.12), badge: change.replace(/_/g, ' ') };
      });
    }

    default:
      return nodes;
  }
}

/** Switch edges in cycles / rule breaks to the problem edge types. */
export function markProblemEdges(
  edges: Edge<CanvasEdgeData>[],
  overlay: OverlayType | null,
  extra: OverlayExtraData,
  index: GraphIndex,
  visibleIds: ReadonlySet<string>,
): Edge<CanvasEdgeData>[] {
  if (overlay === 'cycles') {
    const sets = resolveCycles(extra.cycles, index, visibleIds);
    if (sets.groups.length === 0) return edges;
    return edges.map((e) =>
      e.data && isCycleEdge(e.source, e.target, sets)
        ? { ...e, type: 'cycle', markerEnd: arrowMarker(PROBLEM_COLOR), data: { ...e.data, is_cycle: true } }
        : e,
    );
  }
  if (overlay === 'architecture-violations') {
    const sets = resolveViolations(extra.violations, index, visibleIds);
    if (sets.pairs.size === 0) return edges;
    return edges.map((e) =>
      e.data && sets.pairs.has(`${e.source}->${e.target}`)
        ? { ...e, type: 'violation', markerEnd: arrowMarker(PROBLEM_COLOR), data: { ...e.data, is_violation: true } }
        : e,
    );
  }
  return edges;
}
