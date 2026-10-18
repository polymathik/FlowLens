/**
 * What the user typed → the entry point to trace. Accepts an entry-point
 * label ('GET /api/users', 'cli: start'), an entity id, qualified name, file
 * path or (unique) name — with the same exact-first tiers and ambiguity
 * reporting as the MCP tools (`mcp/entity-resolver.ts`).
 */
import type { EntryPoint } from '../contracts/flow.js';
import type { EntityCandidate } from '../contracts/mcp/tools.js';
import { NameIndex } from '../mcp/name-index.js';
import { isResolveError, resolveWithIndex } from '../mcp/entity-resolver.js';
import type { FlowGraph } from './graph.js';
import { compareEntries } from './entry-points.js';
import { entryForEntity } from './trace.js';

export type TargetResult =
  | { ok: true; entry: EntryPoint }
  | { ok: false; code: 'not_found' | 'ambiguous'; message: string; candidates: EntityCandidate[]; suggestions: string[] };

const best = (list: EntryPoint[]): EntryPoint => [...list].sort((a, b) => b.confidence - a.confidence || compareEntries(a, b))[0];

function nameIndex(graph: FlowGraph): NameIndex {
  return graph.memoize('flow:name-index', () => new NameIndex(graph.entities));
}

function asCandidate(e: EntryPoint): EntityCandidate {
  return { id: e.entity_id, kind: 'function', qualified_name: e.label, file: e.file, line: e.line };
}

/** Plain edit distance (labels are short). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
}

/** Entry labels close to what was typed ('GET /api/userz' → 'GET /api/users'), nearest first. */
export function closestLabels(entries: EntryPoint[], query: string, limit = 5): string[] {
  const lower = query.toLowerCase();
  const scored = [...new Set(entries.map((e) => e.label))]
    .map((label) => ({ label, d: distance(lower, label.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(3, Math.floor(lower.length / 4)))
    .sort((a, b) => a.d - b.d || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map((x) => x.label);
}

export function resolveTraceTarget(graph: FlowGraph, entries: EntryPoint[], query: string): TargetResult {
  const q = query.trim();
  const lower = q.toLowerCase();
  const exactLabel = entries.filter((e) => e.label.toLowerCase() === lower);
  if (exactLabel.length > 0) return { ok: true, entry: best(exactLabel) };

  const r = resolveWithIndex(nameIndex(graph), q);
  if (!isResolveError(r)) {
    const own = entries.filter((e) => e.entity_id === r.entity.id && !e.span && e.kind !== 'test');
    return { ok: true, entry: own.length > 0 ? best(own) : entryForEntity(r.entity) };
  }
  const partial = entries.filter((e) => e.label.toLowerCase().includes(lower));
  if (r.code === 'not_found' && partial.length > 0) {
    const top = [...partial].sort(compareEntries);
    if (top.length === 1) return { ok: true, entry: top[0] };
    return {
      ok: false, code: 'ambiguous',
      message: `'${q}' matches ${top.length} entry points. Retry with one of the labels.`,
      candidates: top.slice(0, 10).map(asCandidate), suggestions: top.slice(0, 10).map((e) => e.label),
    };
  }
  const labels = r.code === 'not_found' ? closestLabels(entries, q) : [];
  return { ok: false, code: r.code, message: r.error, candidates: r.candidates ?? [], suggestions: [...labels, ...r.suggestions] };
}

