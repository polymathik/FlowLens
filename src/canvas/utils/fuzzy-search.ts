/**
 * Fuzzy symbol search — case-insensitive subsequence matching with a simple
 * score: contiguous runs, word-boundary hits and prefix matches score
 * higher; matches on the short name beat matches on the qualified name.
 */
import type { Entity } from '../../contracts/entities.js';

const SEARCHABLE_SKIP = new Set(['parameter', 'enum_member', 'decorator']);

/**
 * Score `query` against `text`. Returns null when `query` is not a
 * subsequence of `text`; otherwise a positive score (higher is better).
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 1000;

  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    score += 1;
    if (found === prevMatch + 1) score += 5; // contiguous run
    if (found === 0) score += 8; // prefix
    else if (isBoundary(text, found)) score += 4; // word / camelCase boundary
    prevMatch = found;
  }
  if (t.startsWith(q)) score += 20;
  else if (t.includes(q)) score += 10;
  // Prefer shorter texts (tighter matches).
  score -= Math.min(text.length - q.length, 30) * 0.1;
  return score;
}

function isBoundary(text: string, i: number): boolean {
  const prev = text[i - 1];
  const cur = text[i];
  if (prev === undefined) return true;
  if (/[\s_\-./:#]/.test(prev)) return true;
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

export interface SearchHit {
  entity: Entity;
  score: number;
}

/** Rank entities for `query`; returns at most `limit` hits, best first. */
export function searchEntities(
  entities: Entity[],
  query: string,
  limit = 12,
): SearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const hits: SearchHit[] = [];
  for (const entity of entities) {
    if (SEARCHABLE_SKIP.has(entity.kind)) continue;
    const nameScore = fuzzyScore(q, entity.name ?? '');
    const qnScore = fuzzyScore(q, entity.qualified_name ?? '');
    const best = Math.max(
      nameScore !== null ? nameScore + 15 : -Infinity,
      qnScore ?? -Infinity,
    );
    if (best === -Infinity) continue;
    hits.push({ entity, score: best });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.entity.name.length - b.entity.name.length ||
      a.entity.qualified_name.localeCompare(b.entity.qualified_name),
  );
  return hits.slice(0, limit);
}
