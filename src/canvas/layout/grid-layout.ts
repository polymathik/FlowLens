/**
 * Deterministic grid for sets without links: nodes sorted by kind then
 * name, row-major, in a near-landscape arrangement. The same set always
 * yields the same picture (no simulation, no randomness).
 */
import type { LayoutBox, Positions } from './types';

export interface GridOptions {
  gap?: number;
  /** Target width / height of the grid. */
  aspect?: number;
  originX?: number;
  originY?: number;
}

export function gridLayout(boxes: LayoutBox[], options: GridOptions = {}): Positions {
  const { gap = 28, aspect = 1.6, originX = 0, originY = 0 } = options;
  const out: Positions = new Map();
  if (boxes.length === 0) return out;
  const cellW = Math.max(...boxes.map((b) => b.width)) + gap;
  const cellH = Math.max(...boxes.map((b) => b.height)) + gap;
  const cols = Math.max(1, Math.min(boxes.length, Math.round(Math.sqrt((boxes.length * aspect * cellH) / cellW))));
  boxes.forEach((b, i) => {
    out.set(b.id, { x: originX + (i % cols) * cellW, y: originY + Math.floor(i / cols) * cellH });
  });
  return out;
}

export function boundsOf(boxes: LayoutBox[], positions: Positions): { width: number; height: number } {
  let w = 0;
  let h = 0;
  for (const b of boxes) {
    const p = positions.get(b.id);
    if (p) {
      w = Math.max(w, p.x + b.width);
      h = Math.max(h, p.y + b.height);
    }
  }
  return { width: w, height: h };
}
