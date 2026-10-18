/**
 * Entity resolution for MCP tools: exact-first tiers (see `name-index.ts`),
 * a structured `ambiguous` error listing up to 10 candidates instead of
 * silently picking one, and edit-distance "did you mean" suggestions.
 */

import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';
import type { EntityCandidate, ToolErrorCode } from '../contracts/mcp/tools.js';
import type { GraphView } from './graph-view.js';
import { NameIndex, type ResolveTier } from './name-index.js';

export const MAX_CANDIDATES = 10;

export interface ResolveResult {
  entity: Entity;
  tier: ResolveTier;
}

export interface ResolveError {
  error: string;
  code: Extract<ToolErrorCode, 'not_found' | 'ambiguous'>;
  suggestions: string[];
  candidates?: EntityCandidate[];
}

export type ResolveOutcome = ResolveResult | ResolveError;

export function isResolveError(r: ResolveOutcome): r is ResolveError {
  return 'error' in r;
}

export function toCandidate(e: Entity): EntityCandidate {
  return { id: e.id, kind: e.kind, qualified_name: e.qualified_name, file: e.file, line: e.location?.line_start ?? 0 };
}

/** Resolve against a cached graph view (preferred: uses the prebuilt name index). */
export function resolveInView(view: GraphView, identifier: string): ResolveOutcome {
  return resolveWithIndex(view.names, identifier);
}

/** Resolve directly against a store (builds a one-off index; used outside the MCP server). */
export async function resolveEntity(graph: GraphStore, identifier: string): Promise<ResolveOutcome> {
  const byId = await graph.getNode(identifier);
  if (byId) return { entity: byId, tier: 'id' };
  return resolveWithIndex(new NameIndex(await graph.getAllNodes()), identifier);
}

/** Resolve against a prebuilt name index (shared by MCP tools, the flow service and the CLI). */
export function resolveWithIndex(index: NameIndex, identifier: string): ResolveOutcome {
  const match = index.match(identifier);
  if (match && match.candidates.length === 1) {
    return { entity: match.candidates[0], tier: match.tier };
  }
  if (match && match.candidates.length > 1) {
    const sorted = [...match.candidates].sort(byKindThenQn);
    const shown = sorted.slice(0, MAX_CANDIDATES);
    return {
      error: `Ambiguous entity: '${identifier}' matches ${sorted.length} entities (by ${match.tier.replace('_', ' ')}). `
        + 'Retry with one of the candidate ids or qualified names.',
      code: 'ambiguous',
      candidates: shown.map(toCandidate),
      suggestions: shown.map((e) => e.qualified_name),
    };
  }
  const similar = index.suggest(identifier);
  return {
    error: `Entity not found: '${identifier}'`,
    code: 'not_found',
    suggestions: similar.map((e) => `did you mean ${e.qualified_name} (${e.kind})?`),
  };
}

const KIND_RANK: Record<string, number> = {
  file: 0, module: 0, class: 1, interface: 1, function: 2, type: 2, enum: 2, method: 3,
};

function byKindThenQn(a: Entity, b: Entity): number {
  return (KIND_RANK[a.kind] ?? 5) - (KIND_RANK[b.kind] ?? 5) || a.qualified_name.localeCompare(b.qualified_name);
}
