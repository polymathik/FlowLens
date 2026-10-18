/**
 * Deterministic swimlane layout of a flow (pure, synchronous, no ELK).
 *
 *   x = column (distance from the root; callers on the left for `in`)
 *   y = lane band (package → folder, in the trace's lane order), cards stacked inside a band in call order
 *
 * Why not ELK: the picture is a tree read left to right inside fixed bands. ELK's `partitioning` orders
 * partitions ALONG the layout direction (it makes column groups, not crosswise bands) and a layered layout
 * is free to reorder siblings, which breaks "reading top to bottom follows execution". Here the rule is
 * explicit: inside one lane and column cards are ordered by call sequence, and a card is placed level with
 * its parent when the parent is in the same lane (straight lines for the common case), otherwise just below
 * the previous card of the stack. Same trace in, same picture out; no randomness, nothing to cache but the
 * result. Lane height = the tallest column of that lane.
 *
 * A column of one lane never grows taller than `maxRows` cards: the next ones continue in a sub-column to
 * its right (reading order stays top to bottom, then left to right), so a fan-out of a hundred calls is a
 * block, not a one-pixel-wide strip.
 */
import type { FlowCard, FlowModel } from '../../../contracts/canvas/index.js';

export const FLOW_GEOMETRY = {
  cardW: 236,
  cardH: 56,
  /** Space between columns: holds the call-site labels. */
  colGap: 150,
  rowGap: 14,
  /** Left strip of a lane with its header chip. */
  gutter: 176,
  padX: 24,
  padY: 20,
  laneGap: 14,
  /** The root card is wider (it carries the entry label); the extra space goes to the outer side of its column. */
  rootExtra: 100,
  /** Cards per lane and column before it wraps into a sub-column (more for a very large group, to keep the picture's proportions). */
  maxRows: 10,
  maxRowsCap: 20,
  /** Space between sub-columns of one column. */
  subGap: 28,
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowLayout {
  cards: Map<string, Rect>;
  lanes: Map<string, Rect>;
  width: number;
  height: number;
}

/**
 * Left edge of a column; `shift` moves the whole grid right (room for a wider root card on the left),
 * `subCols[k]` is the number of sub-columns column k needs (default 1 each).
 */
export function columnX(column: number, shift = 0, subCols: readonly number[] = []): number {
  const g = FLOW_GEOMETRY;
  let extra = 0;
  for (let k = 0; k < column; k++) extra += (Math.max(subCols[k] ?? 1, 1) - 1) * (g.cardW + g.subGap);
  return g.gutter + g.padX + shift + column * (g.cardW + g.colGap) + extra;
}

/** Position of a card inside its lane: `row` counts from the top of the lane, `sub` the sub-column of its column. */
export interface Slot {
  row: number;
  sub: number;
}

/** Rows a lane column may have before it wraps: 10, or about √(3n) for a group of n cards, so a huge fan-out stays roughly 2:1 instead of a long strip. */
export function rowLimit(model: Pick<FlowModel, 'cards'>): number {
  const groups = new Map<string, number>();
  for (const c of model.cards) groups.set(`${c.laneId}|${c.column}`, (groups.get(`${c.laneId}|${c.column}`) ?? 0) + 1);
  const biggest = Math.max(0, ...groups.values());
  return Math.min(FLOW_GEOMETRY.maxRowsCap, Math.max(FLOW_GEOMETRY.maxRows, Math.round(Math.sqrt(biggest * 3))));
}

/** Slot of each card inside its lane, in call order, level with the parent when it is in the same lane; wraps at `maxRows`. */
export function assignSlots(model: Pick<FlowModel, 'cards' | 'direction' | 'columns'>): Map<string, Slot> {
  const byId = new Map(model.cards.map((c) => [c.id, c]));
  const slots = new Map<string, Slot>();
  const limit = rowLimit(model);
  const lanes = new Map<string, FlowCard[]>();
  for (const c of model.cards) lanes.set(c.laneId, [...(lanes.get(c.laneId) ?? []), c]);
  // Parents must be placed before children: walk the columns away from the root.
  const order = Array.from({ length: model.columns }, (_, i) => (model.direction === 'out' ? i : model.columns - 1 - i));
  for (const cards of lanes.values()) {
    for (const col of order) {
      let prev = -1;
      let sub = 0;
      for (const c of cards.filter((x) => x.column === col).sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))) {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        // Only the first sub-column lines up with the parent; later ones start at the top.
        const level = sub === 0 && parent && parent.laneId === c.laneId ? (slots.get(parent.id)?.row ?? -1) : -1;
        let row = Math.max(prev + 1, level);
        if (row >= limit) {
          sub++;
          row = 0;
        }
        slots.set(c.id, { row, sub });
        prev = row;
      }
    }
  }
  return slots;
}

export function layoutFlow(model: Pick<FlowModel, 'cards' | 'lanes' | 'direction' | 'columns'>): FlowLayout {
  const g = FLOW_GEOMETRY;
  const slots = assignSlots(model);
  const subCols = Array.from({ length: Math.max(model.columns, 1) }, (_, col) =>
    model.cards.filter((c) => c.column === col).reduce((m, c) => Math.max(m, (slots.get(c.id)?.sub ?? 0) + 1), 1));
  const shift = model.direction === 'out' ? g.rootExtra : 0;
  const width = columnX(Math.max(model.columns, 1), shift, subCols) - g.colGap + g.padX + (model.direction === 'in' ? g.rootExtra : 0);
  const cards = new Map<string, Rect>();
  const lanes = new Map<string, Rect>();
  let top = 0;
  for (const lane of model.lanes) {
    const own = model.cards.filter((c) => c.laneId === lane.id);
    const rowCount = own.reduce((m, c) => Math.max(m, (slots.get(c.id)?.row ?? 0) + 1), 1);
    const height = g.padY * 2 + rowCount * g.cardH + (rowCount - 1) * g.rowGap;
    lanes.set(lane.id, { x: 0, y: top, w: width, h: height });
    for (const c of own) {
      const root = c.role === 'root';
      const slot = slots.get(c.id) ?? { row: 0, sub: 0 };
      const x = columnX(c.column, shift, subCols) + slot.sub * (g.cardW + g.subGap) - (root && model.direction === 'out' ? g.rootExtra : 0);
      cards.set(c.id, { x, y: top + g.padY + slot.row * (g.cardH + g.rowGap), w: g.cardW + (root ? g.rootExtra : 0), h: g.cardH });
    }
    top += height + g.laneGap;
  }
  return { cards, lanes, width, height: Math.max(top - g.laneGap, 0) };
}
