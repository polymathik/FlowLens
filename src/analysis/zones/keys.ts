/** Small pure helpers shared by the zoning modules: ids, ordering, hashing. */
import type { ZoningMode } from '../../contracts/zones.js';

export const zoneId = (mode: ZoningMode, key: string): string => `zone:${mode}:${key}`;

/** Case-insensitive ordering with a case-sensitive tie break (same rule as the hierarchy builder). */
export function compareText(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** FNV-1a (32 bit) over UTF-16 code units: stable across runs, platforms and Node versions. */
export function hashKey(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Repo-relative, forward-slash path (how the hierarchy indexes files). */
export const normalizePath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');

/** Claim `wanted` in `used`; on a clash use the first free of `fallbacks`, then numbered variants. */
export function claimKey(used: Set<string>, wanted: string, ...fallbacks: string[]): string {
  for (const k of [wanted, ...fallbacks]) {
    if (!used.has(k)) {
      used.add(k);
      return k;
    }
  }
  for (let n = 2; ; n++) {
    const k = `${wanted}#${n}`;
    if (!used.has(k)) {
      used.add(k);
      return k;
    }
  }
}
