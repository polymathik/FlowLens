/**
 * get_dependents tool — finds everything that depends on a given entity.
 *
 * Returns direct dependents by default, with optional transitive closure
 * via BFS when include_transitive is set.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface GetDependentsInput {
  entity: string;
  include_transitive?: boolean;
  max_results?: number;
}

export interface DependentEntry {
  entity: Entity;
  relation: Relation;
  is_direct: boolean;
}

export interface GetDependentsResult {
  entity: Entity;
  dependents: DependentEntry[];
  risk_score: number;
}

const MAX_RESULTS_CAP = 250;

export async function handleGetDependents(
  args: GetDependentsInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const outcome = await resolveEntity(deps.graph, args.entity);

  if (isResolveError(outcome)) {
    return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
  }

  const { entity } = outcome;
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);
  const includeTransitive = args.include_transitive ?? false;

  // Collect direct inbound edges
  const directEdges = await deps.graph.getEdgesTo(entity.id);
  const dependents: DependentEntry[] = [];
  const visited = new Set<string>([entity.id]);

  for (const rel of directEdges) {
    if (dependents.length >= maxResults) break;
    if (visited.has(rel.from)) continue;
    visited.add(rel.from);

    const depEntity = await deps.graph.getNode(rel.from);
    if (!depEntity) continue;

    dependents.push({ entity: depEntity, relation: rel, is_direct: true });
  }

  // Transitive closure via BFS if requested
  if (includeTransitive) {
    const frontier = directEdges.map(r => r.from).filter(id => !visited.has(id) || true);
    // Use visited set from above; BFS from direct dependents outward
    let queue = [...new Set(directEdges.map(r => r.from))];

    while (queue.length > 0 && dependents.length < maxResults) {
      const nextQueue: string[] = [];

      for (const nodeId of queue) {
        if (dependents.length >= maxResults) break;

        const edges = await deps.graph.getEdgesTo(nodeId);
        for (const rel of edges) {
          if (dependents.length >= maxResults) break;
          if (visited.has(rel.from)) continue;
          visited.add(rel.from);

          const depEntity = await deps.graph.getNode(rel.from);
          if (!depEntity) continue;

          dependents.push({ entity: depEntity, relation: rel, is_direct: false });
          nextQueue.push(rel.from);
        }
      }

      queue = nextQueue;
    }
  }

  // Compute risk score: dependents.length / total entities (0-1 normalized)
  const allNodes = await deps.graph.getAllNodes();
  const totalEntities = allNodes.length;
  const riskScore = totalEntities > 0
    ? Math.min(dependents.length / totalEntities, 1)
    : 0;

  const data: GetDependentsResult = {
    entity,
    dependents,
    risk_score: Math.round(riskScore * 1000) / 1000,
  };

  const response = buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: dependents.length,
  });

  return toMCPContent(response);
}

export function registerGetDependents(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_dependents',
    {
      description:
        'Finds all entities that depend on a given entity, with optional transitive closure.',
      inputSchema: {
        entity: z.string().describe('Entity identifier: qualified name, ID, or file path'),
        include_transitive: z.boolean().optional().default(false).describe('Include transitive dependents'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetDependents(args as GetDependentsInput, deps),
  );
}
