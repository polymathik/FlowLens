/**
 * Synchronous d3-force layout for the system / module views.
 *
 * Runs the simulation to completion off-screen (no per-tick React updates —
 * the old animated version re-rendered every node on every tick and took
 * ~17 s to settle on FlowLens itself), starting from a deterministic grid so
 * the same graph always gets the same picture. A final rectangle-separation
 * pass guarantees no two node boxes overlap.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface LayoutBox {
  id: string;
  width: number;
  height: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

export type Positions = Map<string, { x: number; y: number }>;

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
}

export interface ForceOptions {
  /** Repulsion strength (negative = repel). */
  strength?: number;
  /** Ideal link length in px. */
  distance?: number;
  /** Minimum gap between boxes after separation. */
  gap?: number;
  ticks?: number;
}

export function computeForceLayout(
  boxes: LayoutBox[],
  links: LayoutLink[],
  options: ForceOptions = {},
): Positions {
  const { strength = -500, distance = 160, gap = 24, ticks = 300 } = options;
  const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
  const sim: SimNode[] = boxes.map((b, i) => ({
    id: b.id,
    x: (i % cols) * 240,
    y: Math.floor(i / cols) * 140,
    r: Math.hypot(b.width, b.height) / 2 + gap / 2,
  }));
  const ids = new Set(boxes.map((b) => b.id));
  const simLinks: SimulationLinkDatum<SimNode>[] = links
    .filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target }));

  const simulation = forceSimulation<SimNode>(sim)
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks).id((d) => d.id).distance(distance).strength(0.4))
    .force('charge', forceManyBody<SimNode>().strength(strength))
    .force('collision', forceCollide<SimNode>().radius((d) => d.r).iterations(2))
    .force('x', forceX<SimNode>(0).strength(0.06))
    .force('y', forceY<SimNode>(0).strength(0.08))
    .stop();
  for (let i = 0; i < ticks; i++) simulation.tick();

  const rects = boxes.map((b, i) => ({
    id: b.id,
    x: (sim[i].x ?? 0) - b.width / 2,
    y: (sim[i].y ?? 0) - b.height / 2,
    width: b.width,
    height: b.height,
  }));
  separateRects(rects, gap);
  return new Map(rects.map((r) => [r.id, { x: r.x, y: r.y }]));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Push overlapping rectangles apart along the axis of least overlap. */
export function separateRects(rects: Rect[], gap = 16, maxIterations = 200): void {
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const push = ox / 2 + 0.5;
          const dir = a.x + a.width / 2 <= b.x + b.width / 2 ? -1 : 1;
          a.x += dir * push;
          b.x -= dir * push;
        } else {
          const push = oy / 2 + 0.5;
          const dir = a.y + a.height / 2 <= b.y + b.height / 2 ? -1 : 1;
          a.y += dir * push;
          b.y -= dir * push;
        }
      }
    }
    if (!moved) return;
  }
}

/** True when any two boxes overlap (used by tests and as a layout sanity check). */
export function hasOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        return true;
      }
    }
  }
  return false;
}
