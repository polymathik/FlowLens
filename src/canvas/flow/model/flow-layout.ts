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
  rootExtra: 64,
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

/** Left edge of a column; `shift` moves the whole grid right (room for a wider root card on the left). */
export const columnX = (column: number, shift = 0): number => FLOW_GEOMETRY.gutter + FLOW_GEOMETRY.padX + shift + column * (FLOW_GEOMETRY.cardW + FLOW_GEOMETRY.colGap);

/** Rows of each card inside its lane (0-based), in call order, level with the parent when it is in the same lane. */
export function assignRows(model: Pick<FlowModel, 'cards' | 'direction' | 'columns'>): Map<string, number> {
  const byId = new Map(model.cards.map((c) => [c.id, c]));
  const rows = new Map<string, number>();
  const lanes = new Map<string, FlowCard[]>();
  for (const c of model.cards) lanes.set(c.laneId, [...(lanes.get(c.laneId) ?? []), c]);
  // Parents must be placed before children: walk the columns away from the root.
  const order = Array.from({ length: model.columns }, (_, i) => (model.direction === 'out' ? i : model.columns - 1 - i));
  for (const cards of lanes.values()) {
    for (const col of order) {
      let prev = -1;
      for (const c of cards.filter((x) => x.column === col).sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))) {
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        const level = parent && parent.laneId === c.laneId ? (rows.get(parent.id) ?? -1) : -1;
        const row = Math.max(prev + 1, level);
        rows.set(c.id, row);
        prev = row;
      }
    }
  }
  return rows;
}

export function layoutFlow(model: Pick<FlowModel, 'cards' | 'lanes' | 'direction' | 'columns'>): FlowLayout {
  const g = FLOW_GEOMETRY;
  const rows = assignRows(model);
  const shift = model.direction === 'out' ? g.rootExtra : 0;
  const width = columnX(Math.max(model.columns, 1), shift) - g.colGap + g.padX + (model.direction === 'in' ? g.rootExtra : 0);
  const cards = new Map<string, Rect>();
  const lanes = new Map<string, Rect>();
  let top = 0;
  for (const lane of model.lanes) {
    const own = model.cards.filter((c) => c.laneId === lane.id);
    const rowCount = own.reduce((m, c) => Math.max(m, (rows.get(c.id) ?? 0) + 1), 1);
    const height = g.padY * 2 + rowCount * g.cardH + (rowCount - 1) * g.rowGap;
    lanes.set(lane.id, { x: 0, y: top, w: width, h: height });
    for (const c of own) {
      const root = c.role === 'root';
      const x = columnX(c.column, shift) - (root && model.direction === 'out' ? g.rootExtra : 0);
      cards.set(c.id, { x, y: top + g.padY + (rows.get(c.id) ?? 0) * (g.cardH + g.rowGap), w: g.cardW + (root ? g.rootExtra : 0), h: g.cardH });
    }
    top += height + g.laneGap;
  }
  return { cards, lanes, width, height: Math.max(top - g.laneGap, 0) };
}
