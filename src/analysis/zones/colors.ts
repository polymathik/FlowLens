/** Deterministic colour slots: hash of the key, nudged so siblings differ when possible. */
import { ZONE_COLOR_SLOTS } from '../../contracts/zones.js';
import { hashKey } from './keys.js';

export interface ColorRequest {
  key: string;
  /** Slot forced by the user's override. */
  fixed?: number;
}

/**
 * Colours for one sibling group, given in display order.
 *
 * Each free zone starts at `hash(key) mod slots` and takes the least-used
 * slot from there (the parent's colour and forced colours count as used), never
 * the same slot as its display neighbours. With up to `slots - 1` siblings
 * all colours differ; without conflicts a zone keeps exactly its hash slot.
 */
export function assignColors(group: ColorRequest[], parentColor?: number): number[] {
  const uses = new Array<number>(ZONE_COLOR_SLOTS).fill(0);
  if (parentColor !== undefined) uses[parentColor] += 1;
  for (const g of group) if (g.fixed !== undefined) uses[g.fixed] += 1;
  const out: number[] = [];
  for (let i = 0; i < group.length; i++) {
    const g = group[i];
    if (g.fixed !== undefined) {
      out.push(g.fixed);
      continue;
    }
    const avoid = new Set<number>();
    if (i > 0) avoid.add(out[i - 1]);
    const next = group[i + 1]?.fixed;
    if (next !== undefined) avoid.add(next);
    const start = hashKey(g.key) % ZONE_COLOR_SLOTS;
    let best = -1;
    for (let k = 0; k < ZONE_COLOR_SLOTS; k++) {
      const c = (start + k) % ZONE_COLOR_SLOTS;
      if (avoid.has(c)) continue;
      if (best < 0 || uses[c] < uses[best]) best = c;
    }
    if (best < 0) best = start; // unreachable with >= 3 slots, kept for safety
    uses[best] += 1;
    out.push(best);
  }
  return out;
}
