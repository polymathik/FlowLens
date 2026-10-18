/**
 * One rendered step of the timeline as a `Frame` (see decorate.ts): the
 * state of every card at the playhead, the counts per item, and what to
 * compare against (the previous step, or commit A while comparing). Pure.
 */
import { compareFiles } from './compare.js';
import { countItems, type Frame } from './decorate.js';
import type { ItemMap } from './items.js';
import { ANIMATE_MAX_STEP, heatWindow, statesAt, type FileState, type Lives, type StateOptions } from './lives.js';

export interface FrameInput {
  lives: Lives;
  items: ItemMap;
  /** The playhead (commit B while comparing). */
  index: number;
  /** The previously rendered playhead. */
  prev: number;
  /** Commit A when comparing. */
  compareFrom: number | null;
  reduced: boolean;
  /** Alive-edge weights at the playhead's sample; null without link history. */
  edges: Map<string, number> | null;
  /** Number of commits (the newest is `commits - 1`). */
  commits: number;
}

export function buildFrame(input: FrameInput): Frame {
  const { lives, items, index, prev, compareFrom, reduced, edges, commits } = input;
  const opts: StateOptions = { last: commits - 1, heatWindow: heatWindow(commits) };
  const comparing = compareFrom !== null;
  const states = statesAt(lives, index, comparing ? index : prev, opts);
  const compare = comparing ? compareFiles(lives, compareFrom, index) : null;
  if (compare) {
    // Files gone since A stay on the map as red ghosts, so the zone they sit in stays visible.
    const ghost: FileState = { phase: 'ghost', heat: 0, entered: false, pulsed: false, deletedAt: index };
    for (const p of compare.removed) states.set(p, ghost);
  }
  const counts = countItems(items, states);
  // The +N chips say what the last STEP did; after a long jump there is no step to speak of.
  const against = comparing ? compareFrom : Math.abs(index - prev) <= ANIMATE_MAX_STEP ? prev : index;
  const prevLive = new Map<string, number>();
  if (against === index) for (const [id, c] of counts) prevLive.set(id, c.count);
  else for (const [id, c] of countItems(items, statesAt(lives, against, against, opts))) prevLive.set(id, c.count);
  return { index, items, states, counts, prevLive, compare, reduced, edges };
}
