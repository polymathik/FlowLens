/**
 * get_context tool — retrieves full context around a code entity including
 * relations, metrics, and annotations.
 *
 * BFS traversal collects relations at each depth level up to the requested
 * depth, then caps at max_results.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { Annotation } from '../../contracts/mcp/annotations.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface GetContextInput {
  entity: string;
  depth?: number;
  relation_types?: string[];
  include_metrics?: boolean;
  max_results?: number;
}

export interface ContextRelation {
  relation: Relation;
  connected_entity: Entity;
  direction: 'outbound' | 'inbound';
  depth: number;
}

export interface GetContextResult {
  entity: Entity;
  relations: ContextRelation[];
  annotations: Annotation[];
}

const MAX_RESULTS_CAP = 250;

export async function handleGetContext(
  args: GetContextInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const outcome = await resolveEntity(deps.graph, args.entity);

  if (isResolveError(outcome)) {
    return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
  }

  const { entity } = outcome;
  const depth = args.depth ?? 2;
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);
  const includeMetrics = args.include_metrics ?? true;
  const filterTypes = args.relation_types
    ? new Set(args.relation_types)
    : null;

  // BFS traversal to collect relations at each depth level
  const collected: ContextRelation[] = [];
  const visitedNodes = new Set<string>([entity.id]);
  const visitedRelations = new Set<string>();
  let frontier = [entity.id];

  for (let d = 1; d <= depth && frontier.length > 0 && collected.length < maxResults; d++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      if (collected.length >= maxResults) break;

      // Outbound relations
      const outbound = await deps.graph.getEdgesFrom(nodeId);
      for (const rel of outbound) {
        if (collected.length >= maxResults) break;
        if (visitedRelations.has(rel.id)) continue;
        if (filterTypes && !filterTypes.has(rel.type)) continue;

        visitedRelations.add(rel.id);
        const connected = await deps.graph.getNode(rel.to);
        if (!connected) continue;

        collected.push({
          relation: rel,
          connected_entity: stripMetrics(connected, includeMetrics),
          direction: 'outbound',
          depth: d,
        });

        if (!visitedNodes.has(rel.to)) {
          visitedNodes.add(rel.to);
          nextFrontier.push(rel.to);
        }
      }

      // Inbound relations
      const inbound = await deps.graph.getEdgesTo(nodeId);
      for (const rel of inbound) {
        if (collected.length >= maxResults) break;
        if (visitedRelations.has(rel.id)) continue;
        if (filterTypes && !filterTypes.has(rel.type)) continue;

        visitedRelations.add(rel.id);
        const connected = await deps.graph.getNode(rel.from);
        if (!connected) continue;

        collected.push({
          relation: rel,
          connected_entity: stripMetrics(connected, includeMetrics),
          direction: 'inbound',
          depth: d,
        });

        if (!visitedNodes.has(rel.from)) {
          visitedNodes.add(rel.from);
          nextFrontier.push(rel.from);
        }
      }
    }

    frontier = nextFrontier;
  }

  const annotations = deps.annotationStore.getForEntity(entity.id);

  const resultEntity = stripMetrics(entity, includeMetrics);
  const data: GetContextResult = {
    entity: resultEntity,
    relations: collected,
    annotations,
  };

  // Count total available (for truncation info) — use first-level only as estimate
  const outTotal = await deps.graph.getEdgesFrom(entity.id);
  const inTotal = await deps.graph.getEdgesTo(entity.id);
  const totalEstimate = outTotal.length + inTotal.length;

  const response = buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: collected.length,
    total_count: totalEstimate,
  });

  return toMCPContent(response);
}

function stripMetrics(entity: Entity, includeMetrics: boolean): Entity {
  if (includeMetrics || !entity.metrics) return entity;
  const { metrics: _, ...rest } = entity;
  return rest as Entity;
}

export function registerGetContext(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_context',
    {
      description:
        'Retrieves the full context around a code entity including relations, metrics, and annotations.',
      inputSchema: {
        entity: z.string().describe('Entity identifier: qualified name, ID, or file path'),
        depth: z.number().optional().default(2).describe('Relation traversal depth'),
        relation_types: z.array(z.string()).optional().describe('Filter by relation types'),
        include_metrics: z.boolean().optional().default(true).describe('Include entity metrics'),
        max_results: z.number().optional().default(50).describe('Max relations (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetContext(args as GetContextInput, deps),
  );
}
