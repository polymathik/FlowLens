import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';

export interface ResolveResult {
  entity: Entity;
}

export interface ResolveError {
  error: string;
  suggestions: string[];
}

export type ResolveOutcome = ResolveResult | ResolveError;

export function isResolveError(r: ResolveOutcome): r is ResolveError {
  return 'error' in r;
}

/**
 * Multi-mode entity resolution.
 * Priority: exact ID -> qualified_name -> file path -> partial name.
 */
export async function resolveEntity(
  graph: GraphStore,
  identifier: string,
): Promise<ResolveOutcome> {
  // 1. Try exact ID
  const byId = await graph.getNode(identifier);
  if (byId) return { entity: byId };

  // 2. Try qualified_name (scan all nodes)
  const allNodes = await graph.getAllNodes();
  const byQN = allNodes.find(e => e.qualified_name === identifier);
  if (byQN) return { entity: byQN };

  // 3. Try file path
  const byFile = allNodes.find(e => e.file === identifier && e.kind === 'file');
  if (byFile) return { entity: byFile };

  // 4. Partial name search
  const matches = allNodes.filter(e =>
    e.name === identifier ||
    e.name.toLowerCase() === identifier.toLowerCase() ||
    e.qualified_name.includes(identifier),
  );

  if (matches.length === 1) return { entity: matches[0] };
  if (matches.length > 1) {
    return {
      error: `Ambiguous entity: '${identifier}' matches ${matches.length} entities`,
      suggestions: matches.slice(0, 5).map(e => `${e.qualified_name} (${e.kind})`),
    };
  }

  // Not found - find similar names for suggestions
  const similar = allNodes
    .filter(e => e.name.toLowerCase().includes(identifier.toLowerCase().slice(0, 3)))
    .slice(0, 5)
    .map(e => `${e.qualified_name} (${e.kind})`);

  return {
    error: `Entity not found: '${identifier}'`,
    suggestions: similar.length > 0 ? similar : [],
  };
}
