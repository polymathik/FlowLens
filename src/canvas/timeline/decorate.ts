/**
 * Time travel on the laid-out map: the nodes and edges of the cut get a CSS
 * class and a few numbers per rendered step; positions and sizes are never
 * touched, so nothing moves while the timeline plays.
 *
 *   file card   live (heat tint) | new (pop-in) | modified (pulse) | ghost (dashed, faded) | absent (hidden)
 *   zone        hidden when no file is alive; chip count = files then; `timeline.delta` = change since the last step
 *   edge        hidden without link history; with it, only edges alive at the current sample, re-counted
 *   compare     added (green ring), removed (red ghost), changed (amber ring) between two commits
 *
 * A node object is reused when nothing about it changed (React Flow then skips it).
 */
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, FileNodeData, ZoneNodeData } from '../../contracts/canvas/index.js';
import type { FileState } from './lives.js';
import type { FileCompare } from './compare.js';
import type { ItemMap } from './items.js';

export interface ItemCount {
  count: number;
  total: number;
  ghosts: number;
}

export interface Frame {
  index: number;
  items: ItemMap;
  states: Map<string, FileState>;
  counts: Map<string, ItemCount>;
  /** Live files per item at the previous step (or at commit `from` while comparing). */
  prevLive: Map<string, number>;
  compare: FileCompare | null;
  /** Plain redraws only: no entering / pulse classes. */
  reduced: boolean;
  /** Weight of every alive edge (`source>target`); null: no link history, edges are hidden. */
  edges: Map<string, number> | null;
}

const NONE: FileState = { phase: 'absent', heat: 0, entered: false, pulsed: false, deletedAt: -1 };

/** Live / ghost totals of every item. */
export function countItems(items: ItemMap, states: Map<string, FileState>): Map<string, ItemCount> {
  const out = new Map<string, ItemCount>();
  for (const [id, paths] of items.files) {
    let count = 0;
    let ghosts = 0;
    for (const p of paths) {
      const phase = states.get(p)?.phase;
      if (phase === 'live') count++;
      else if (phase === 'ghost') ghosts++;
    }
    out.set(id, { count, total: paths.length, ghosts });
  }
  return out;
}

const parity = (i: number): string => (i % 2 === 0 ? 'a' : 'b');

function fileClasses(path: string, f: Frame): { cls: string; heat: number } {
  const s = f.states.get(path) ?? NONE;
  const cmp = f.compare;
  const classes: string[] = ['fl-tl'];
  let heat = 0;
  if (cmp) {
    if (cmp.removed.has(path)) classes.push('fl-tl-ghost', 'fl-tl-cmp-removed');
    else if (s.phase === 'live') {
      if (cmp.added.has(path)) classes.push('fl-tl-cmp-added');
      else if (cmp.changed.has(path)) classes.push('fl-tl-cmp-changed');
      else classes.push('fl-tl-cmp-same');
    } else classes.push('fl-tl-absent');
    return { cls: classes.join(' '), heat };
  }
  if (s.phase === 'absent') classes.push('fl-tl-absent');
  else if (s.phase === 'ghost') classes.push('fl-tl-ghost');
  else {
    heat = s.heat;
    if (heat > 0.02) classes.push('fl-tl-heat');
    if (!f.reduced && s.entered) classes.push(`fl-tl-in-${parity(f.index)}`);
    else if (!f.reduced && s.pulsed) classes.push(`fl-tl-pulse-${parity(f.index)}`);
  }
  return { cls: classes.join(' '), heat };
}

interface Cached {
  sig: string;
  node: Node;
}
const cache = new WeakMap<Node, Cached>();

const withClass = (n: Node, cls: string, style?: Record<string, string>): Node => {
  const className = [n.className, cls].filter(Boolean).join(' ');
  return { ...n, className, ...(style ? { style: { ...n.style, ...style } } : {}) };
};

/** `visible` collects the ids of the nodes that are shown (for edge filtering). */
export function decorateNodes(nodes: Node[], f: Frame, visible: Set<string>): Node[] {
  return nodes.map((n) => {
    let sig: string;
    let make: () => Node;
    let shown = true;
    if (n.type === 'file') {
      const path = f.items.pathOfItem.get(n.id) ?? (n.data as FileNodeData).filePath;
      const { cls, heat } = fileClasses(path, f);
      shown = !cls.includes('fl-tl-absent');
      sig = `${cls}|${heat.toFixed(2)}`;
      make = () => withClass(n, cls, heat > 0.02 ? { '--fl-tl-heat': heat.toFixed(2) } : undefined);
    } else if (n.type === 'zone') {
      const c = f.counts.get(n.id) ?? { count: 0, total: 0, ghosts: 0 };
      const prev = f.prevLive.get(n.id) ?? c.count;
      const delta = c.count - prev;
      shown = c.count > 0 || c.ghosts > 0;
      const cls = shown ? 'fl-tl' : 'fl-tl fl-tl-absent';
      sig = `${cls}|${c.count}|${delta}|${c.total}`;
      make = () => {
        const data = n.data as ZoneNodeData;
        const timeline = { count: c.count, delta, total: c.total };
        return { ...withClass(n, cls), data: { ...data, fileCount: c.count, timeline } };
      };
    } else {
      shown = false; // portals and the scope node describe today's links: not part of the past
      sig = 'hidden';
      make = () => ({ ...n, hidden: true });
    }
    if (shown) visible.add(n.id);
    const hit = cache.get(n);
    if (hit && hit.sig === sig) return hit.node;
    const node = make();
    cache.set(n, { sig, node });
    return node;
  });
}

const weightLabel = (w: number): string => `${w} link${w === 1 ? '' : 's'}`;

const edgeCache = new WeakMap<Edge, { sig: string; edge: Edge }>();

export function decorateEdges(edges: Edge<CanvasEdgeData>[], f: Frame, visible: ReadonlySet<string>): Edge<CanvasEdgeData>[] {
  return edges.map((e) => {
    const w = f.edges && !e.data?.portal && visible.has(e.source) && visible.has(e.target) ? f.edges.get(`${e.source}>${e.target}`) : undefined;
    const sig = w === undefined ? 'hidden' : String(w);
    const hit = edgeCache.get(e);
    if (hit && hit.sig === sig) return hit.edge as Edge<CanvasEdgeData>;
    const data = e.data;
    const edge: Edge<CanvasEdgeData> =
      w === undefined
        ? { ...e, hidden: true }
        : !data || data.count === w
          ? { ...e, hidden: false }
          : { ...e, hidden: false, data: { ...data, count: w, label: weightLabel(w), kind: 'aggregated-edge' as const } };
    edgeCache.set(e, { sig, edge });
    return edge;
  });
}
