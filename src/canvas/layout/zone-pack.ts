/**
 * Packing primitives of the zone layout (pure, deterministic):
 *  - `shelfPack`  wraps blocks of different sizes into rows (nested zones, loose items)
 *  - `gridPack`   tidy grid of equal-width cards, columns from sqrt(n), row height = tallest card
 * Input order is the output order, so sorted input gives a sorted picture.
 */
export interface PackBlock {
  id: string;
  w: number;
  h: number;
}

export interface Packed {
  /** Top-left of every block, relative to the packed area. */
  at: Map<string, { x: number; y: number }>;
  /** Row heights actually used (gridPack): cards in a row share the tallest height. */
  heights: Map<string, number>;
  width: number;
  height: number;
}

/** Preferred width / height of a packed area; slightly landscape reads best on a canvas. */
export const PACK_ASPECT = 1.7;

export function shelfPack(blocks: PackBlock[], gap: number, aspect = PACK_ASPECT, minWidth = 0): Packed {
  const at = new Map<string, { x: number; y: number }>();
  const heights = new Map<string, number>();
  if (blocks.length === 0) return { at, heights, width: 0, height: 0 };
  const area = blocks.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const target = Math.max(Math.max(...blocks.map((b) => b.w)), Math.sqrt(area * aspect), minWidth);
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > target) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    at.set(b.id, { x, y });
    heights.set(b.id, b.h);
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
    width = Math.max(width, x - gap);
  }
  return { at, heights, width, height: y + rowH };
}

export function gridColumns(n: number, cellW: number, cellH: number, aspect = PACK_ASPECT): number {
  if (n <= 1) return 1;
  return Math.max(1, Math.min(n, Math.round(Math.sqrt((n * aspect * cellH) / cellW))));
}

export function gridPack(blocks: PackBlock[], gap: number, aspect = PACK_ASPECT): Packed {
  const at = new Map<string, { x: number; y: number }>();
  const heights = new Map<string, number>();
  if (blocks.length === 0) return { at, heights, width: 0, height: 0 };
  const w = Math.max(...blocks.map((b) => b.w));
  const cols = gridColumns(blocks.length, w + gap, Math.max(...blocks.map((b) => b.h)) + gap, aspect);
  let y = 0;
  for (let i = 0; i < blocks.length; i += cols) {
    const row = blocks.slice(i, i + cols);
    const rowH = Math.max(...row.map((b) => b.h));
    row.forEach((b, c) => {
      at.set(b.id, { x: c * (w + gap), y });
      heights.set(b.id, rowH);
    });
    y += rowH + gap;
  }
  return { at, heights, width: Math.min(cols, blocks.length) * (w + gap) - gap, height: y - gap };
}
