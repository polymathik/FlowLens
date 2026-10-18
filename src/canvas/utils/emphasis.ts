/**
 * Edge focus and level of detail for zone views:
 *  - edges whose end is hidden (cards not drawn when zoomed far out) are hidden;
 *  - in the summary tier, portal edges (to tiny stand-ins outside the open container) are
 *    hidden unless focused: the frame-to-frame bundles carry the picture;
 *  - card-level cross-frame edges (`detail`) are drawn only while there are few of them
 *    (<= DETAIL_EDGE_LIMIT) or when focused: a crowd of them is noise beside the bundles;
 *  - edges touching the focused node — or any node inside the focused frame —
 *    are marked `hot`; the edge component draws everything else at ~10%.
 * Edges that need no change keep their identity, so React Flow re-renders only
 * what moved.
 */
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';

/** Above this many card-level cross-frame edges, they appear only for the focused node / frame. */
export const DETAIL_EDGE_LIMIT = 40;

export function emphasise(edges: Edge<CanvasEdgeData>[], nodes: Node[], focusId: string | null, summary = false): Edge<CanvasEdgeData>[] {
  const hiddenIds = new Set(nodes.filter((n) => n.hidden).map((n) => n.id));
  const crowded = edges.filter((e) => e.data?.layer === 'detail').length > DETAIL_EDGE_LIMIT;
  if (hiddenIds.size === 0 && !focusId && !summary && !crowded) return edges;
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const inside = (id: string): boolean => {
    for (let cur: string | undefined = id; cur; cur = parentOf.get(cur)) if (cur === focusId) return true;
    return false;
  };
  return edges.map((e) => {
    const hotEnd = !!focusId && (inside(e.source) || inside(e.target));
    const quiet = !hotEnd && ((summary && e.data?.layer === 'portal') || (crowded && e.data?.layer === 'detail'));
    const hide = hiddenIds.has(e.source) || hiddenIds.has(e.target) || quiet;
    const hot = !hide && hotEnd;
    if (!hide && !hot) return e;
    return { ...e, ...(hide ? { hidden: true } : {}), ...(hot ? { data: { ...e.data!, hot: true }, zIndex: 10 } : {}) };
  });
}
