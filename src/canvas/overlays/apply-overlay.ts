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

/** Theme tokens (tokens.css) so overlays follow light/dark mode. */
export const DIFF_COLORS: Record<string, string> = {
  added: 'var(--fl-diff-added)',
  removed: 'var(--fl-diff-removed)',
  modified: 'var(--fl-diff-modified)',
  visibility: 'var(--fl-diff-visibility)',
  parameter_added: 'var(--fl-diff-removed)',
  parameter_removed: 'var(--fl-diff-removed)',
  type_changed: 'var(--fl-diff-removed)',
  return_changed: 'var(--fl-diff-removed)',
};

/** Node problem highlight (edges keep the literal PROBLEM_COLOR for SVG markers). */
const PROBLEM_NODE = 'var(--fl-overlay-problem)';

const MUTED: NodeOverlayStyle = { tag: 'none', fill: 'var(--fl-overlay-muted-fill)', stroke: 'var(--fl-overlay-muted-stroke)', muted: true };

type Data = Record<string, unknown>;
const num = (n: Node, key: string) => (n.data as Data)[key] as number | undefined;

/** Portals are links, not code: overlays never colour them. */
const decoratable = (n: Node): boolean => n.type !== 'portal';

function decorate(nodes: Node[], fn: (n: Node) => NodeOverlayStyle | undefined): Node[] {
  return nodes.map((n) => {
    const overlay = decoratable(n) ? fn(n) : undefined;
    return overlay ? { ...n, data: { ...n.data, overlay } } : n;
  });
}

/**
 * A problem on a card also marks the zone frames around it (they are visible boxes that "contain" the
 * problem): counts of every member are added to each ancestor frame.
 */
function rollUp(members: Map<string, number>, nodes: Node[]): Map<string, number> {
  if (members.size === 0) return members;
  const parentOf = new Map(nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId!]));
  if (parentOf.size === 0) return members;
  const out = new Map(members);
  for (const [id, count] of members) {
    for (let up = parentOf.get(id); up; up = parentOf.get(up)) out.set(up, (out.get(up) ?? 0) + count);
  }
  return out;
}

function maxOf(nodes: Node[], key: string): number {
  let max = 0;
  for (const n of nodes) if (decoratable(n)) max = Math.max(max, num(n, key) ?? 0);
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
      const members = rollUp(resolveCycles(extra.cycles, index, visibleIds).members, nodes);
      return decorate(nodes, (n) => {
        const count = members.get(n.id);
        if (!count) return { ...MUTED, tag: 'cycles' };
        return {
          tag: 'cycles',
          stroke: PROBLEM_NODE,
          strokeStyle: 'dashed',
          strokeWidth: 2.5,
          fill: withAlpha(PROBLEM_NODE, 0.08),
          badge: count > 1 ? `${count} cycles` : 'in a cycle',
        };
      });
    }

    case 'architecture-violations': {
      const members = rollUp(resolveViolations(extra.violations, index, visibleIds).members, nodes);
      return decorate(nodes, (n) => {
        const count = members.get(n.id);
        if (!count) return { ...MUTED, tag: 'violations' };
        return {
          tag: 'violations',
          stroke: PROBLEM_NODE,
          strokeWidth: 2.5,
          fill: withAlpha(PROBLEM_NODE, 0.08),
          badge: count > 1 ? `${count} rule breaks` : '1 rule break',
        };
      });
    }

    case 'interface-diff': {
      const changes = resolveDiff(extra.diffChanges, index, visibleIds);
      return decorate(nodes, (n) => {
        const change = changes.get(n.id);
        if (!change) return { ...MUTED, tag: 'diff' };
        const c = DIFF_COLORS[change] ?? 'var(--fl-faint)';
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
