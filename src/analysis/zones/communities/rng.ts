/** Seeded, platform-independent randomness for the community search (no `Math.random`). */
import { hashKey } from '../keys.js';

/** mulberry32: tiny, fast, and identical on every JS engine (integer arithmetic only). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed from any strings (project, scope, package…): stable across runs. */
export const seedOf = (...parts: string[]): number => hashKey(parts.join('\u0001'));

/** Fisher-Yates in place. */
export function shuffleInPlace<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
