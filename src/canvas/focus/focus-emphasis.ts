/**
 * Hover in Focus mode: hovering a card strengthens the edges on the shortest paths from the focus to it
 * (every shortest path, via `FocusInfo.preds`) and dims the rest; hovering the focus itself, or a card
 * with no recorded path (a "+N more" card), falls back to "edges touching the hovered node".
 */
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, FocusInfo } from '../../contracts/canvas/index.js';
import { emphasise } from '../utils/emphasis';

export interface FocusEmphasis {
  info: FocusInfo;
  /** File → item (card) that draws it; edges connect items, not files. */
  atomOfFile: Record<string, string>;
}

/** Item-pair keys (`a|b`, both orders) of the edges on shortest paths from the focus to `fileId`. */
export function pathPairs(f: FocusEmphasis, fileId: string): Set<string> | null {
  if (!f.info.preds[fileId]) return null;
  const pairs = new Set<string>();
  const seen = new Set<string>();
  const stack = [fileId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of f.info.preds[cur] ?? []) {
      const a = f.atomOfFile[cur];
      const b = f.atomOfFile[p];
      if (a && b && a !== b) {
        pairs.add(`${a}|${b}`);
        pairs.add(`${b}|${a}`);
      }
      stack.push(p);
    }
  }
  return pairs;
}

export function emphasiseFocus(edges: Edge<CanvasEdgeData>[], nodes: Node[], hoveredId: string | null, f: FocusEmphasis, summary: boolean): Edge<CanvasEdgeData>[] {
  const pairs = hoveredId ? pathPairs(f, hoveredId) : null;
  if (!pairs) return emphasise(edges, nodes, hoveredId, summary);
  const base = emphasise(edges, nodes, null, summary);
  return base.map((e) => {
    if (e.hidden || !pairs.has(`${e.source}|${e.target}`)) return e;
    return { ...e, zIndex: 10, style: { ...e.style, strokeWidth: 3.25 }, data: { ...e.data!, hot: true, onPath: true } };
  });
}
