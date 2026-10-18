/**
 * Name index for entity resolution, built once per graph load.
 *
 * Resolution tiers (first tier with any candidate wins):
 *   1 exact id → 2 exact qualified name → 3 exact file/directory path →
 *   4 exact name → 5 case-insensitive name or qualified name →
 *   6 qualified-name segment suffix ("Class.method", "file.ts/fn") →
 *   7 name prefix → 8 name substring (last resort; never qualified names)
 *
 * From tier 4 on, parameters are only considered when nothing else matches,
 * and candidates nested inside another candidate (its own members) are
 * dropped — so `LevelGraphStore` means the class, not its 38 members.
 */

import type { Entity } from '../contracts/entities.js';

export type ResolveTier =
  | 'id' | 'qualified_name' | 'path' | 'name' | 'name_ci' | 'segment_suffix' | 'name_prefix' | 'name_substring';

export interface TierMatch {
  tier: ResolveTier;
  candidates: Entity[];
}

const MIN_FUZZY_LENGTH = 3;

export class NameIndex {
  private readonly byId = new Map<string, Entity>();
  private readonly byQn = new Map<string, Entity[]>();
  private readonly byPath = new Map<string, Entity[]>();
  private readonly byName = new Map<string, Entity[]>();
  private readonly byLower = new Map<string, Entity[]>();
  private readonly lowered: Array<{ entity: Entity; name: string; qn: string }> = [];
  private uniqueNames: string[] | null = null;

  constructor(private readonly nodes: Entity[]) {
    for (const e of nodes) {
      this.byId.set(e.id, e);
      add(this.byQn, e.qualified_name, e);
      if (e.kind === 'file' || e.kind === 'module') add(this.byPath, e.file, e);
      add(this.byName, e.name, e);
      const name = e.name.toLowerCase();
      const qn = e.qualified_name.toLowerCase();
      add(this.byLower, name, e);
      if (qn !== name) add(this.byLower, qn, e);
      this.lowered.push({ entity: e, name, qn });
    }
  }

  /** Candidates at the first tier that matches anything (empty list if none). */
  match(identifier: string): TierMatch | null {
    const id = identifier.trim();
    if (!id) return null;

    const exactId = this.byId.get(id);
    if (exactId) return { tier: 'id', candidates: [exactId] };

    const exactQn = this.byQn.get(id);
    if (exactQn) return { tier: 'qualified_name', candidates: exactQn };

    const path = this.byPath.get(id.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''));
    if (path) return { tier: 'path', candidates: path };

    const lower = id.toLowerCase();
    const tiers: Array<[ResolveTier, () => Entity[]]> = [
      ['name', () => this.byName.get(id) ?? []],
      ['name_ci', () => uniq(this.byLower.get(lower) ?? [])],
      ['segment_suffix', () => this.scan(({ qn }) => qn.endsWith('/' + lower) || qn.endsWith('.' + lower))],
      ['name_prefix', () => (lower.length >= MIN_FUZZY_LENGTH ? this.scan(({ name }) => name.startsWith(lower)) : [])],
      ['name_substring', () => (lower.length >= MIN_FUZZY_LENGTH ? this.scan(({ name }) => name.includes(lower)) : [])],
    ];
    for (const [tier, find] of tiers) {
      const found = refine(find());
      if (found.length > 0) return { tier, candidates: found };
    }
    return null;
  }

  /** "Did you mean" names by edit distance (closest first). */
  suggest(identifier: string, limit = 5): Entity[] {
    const target = identifier.trim().toLowerCase();
    if (!target) return [];
    this.uniqueNames ??= [...this.byName.keys()];
    const maxDistance = Math.max(2, Math.floor(target.length / 3));
    const scored: Array<[string, number]> = [];
    for (const name of this.uniqueNames) {
      const lowerName = name.toLowerCase();
      if (Math.abs(lowerName.length - target.length) > maxDistance) continue;
      const d = editDistance(target, lowerName, maxDistance);
      if (d <= maxDistance) scored.push([name, d]);
    }
    scored.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const out: Entity[] = [];
    for (const [name] of scored) {
      const best = refine(this.byName.get(name) ?? [])[0];
      if (best) out.push(best);
      if (out.length >= limit) break;
    }
    return out;
  }

  private scan(pred: (row: { name: string; qn: string }) => boolean): Entity[] {
    const out: Entity[] = [];
    for (const row of this.lowered) if (pred(row)) out.push(row.entity);
    return out;
  }
}

/** Drop parameters (unless only parameters matched) and members of other candidates. */
function refine(candidates: Entity[]): Entity[] {
  if (candidates.length <= 1) return candidates;
  const nonParams = candidates.filter((e) => e.kind !== 'parameter');
  const pool = nonParams.length > 0 ? nonParams : candidates;
  const qns = new Set(pool.map((e) => e.qualified_name));
  return pool.filter((e) => !hasAncestorIn(e.qualified_name, qns));
}

function hasAncestorIn(qn: string, qns: Set<string>): boolean {
  for (let i = qn.length - 1; i > 0; i--) {
    const ch = qn[i];
    if ((ch === '/' || ch === '.') && qns.has(qn.slice(0, i))) return true;
  }
  return false;
}

function add(map: Map<string, Entity[]>, key: string, e: Entity): void {
  const list = map.get(key);
  if (list) list.push(e);
  else map.set(key, [e]);
}

function uniq(list: Entity[]): Entity[] {
  return [...new Map(list.map((e) => [e.id, e])).values()];
}

/** Levenshtein distance with early exit once every cell exceeds `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return rowMin;
    prev = cur;
  }
  return prev[b.length];
}
