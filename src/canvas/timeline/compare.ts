/**
 * Compare two commits: which file cards were added, removed or changed
 * between them (in today's names), plus the net file change per item.
 * Pure.
 */
import type { Lives } from './lives.js';
import { liveAt } from './lives.js';

export interface FileCompare {
  from: number;
  to: number;
  added: Set<string>;
  removed: Set<string>;
  /** Alive at both ends and modified, renamed or re-created in between. */
  changed: Set<string>;
}

const countAtMost = (sorted: number[], x: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** From commit `from` to commit `to` (either order): added = alive at `to` only, removed = alive at `from` only. */
export function compareFiles(lives: Lives, from: number, to: number): FileCompare {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const before = liveAt(lives, from);
  const after = liveAt(lives, to);
  const added = new Set<string>();
  const removed = new Set<string>();
  const changed = new Set<string>();
  for (const p of after) if (!before.has(p)) added.add(p);
  for (const p of before) if (!after.has(p)) removed.add(p);
  for (const p of after) {
    if (!before.has(p)) continue;
    const life = lives.get(p)!;
    const k = countAtMost(life.born, hi) - 1;
    const upTo = countAtMost(life.changes, hi);
    if (life.born[k] > lo || (upTo > 0 && life.changes[upTo - 1] > lo && life.changes[upTo - 1] >= life.born[k])) changed.add(p);
  }
  return { from, to, added, removed, changed };
}
