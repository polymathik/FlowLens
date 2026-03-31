/**
 * traverse tool — BFS/DFS walk from a starting entity, respecting
 * direction, depth, relation type filters, and optional layer boundaries.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDependencies } from '../server.js';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';
import { resolveLayer } from '../../analysis/architecture-validator.js';

export interface TraverseInput {
  start: string;
  direction: 'inbound' | 'outbound' | 'both';
  relation_types?: string[];
  max_depth?: number;
  max_nodes?: number;
  stop_at_boundary?: boolean;
}

export interface TraverseNode {
  entity: Entity;
  depth: number;
  layer?: string | null;
}

export interface TraverseEdge {
  relation: Relation;
  direction: 'inbound' | 'outbound';
}

export interface TraverseResult {
  start: Entity;
  nodes: TraverseNode[];
  edges: TraverseEdge[];
  stopped_at_boundaries: string[];
}

const MAX_NODES_CAP = 500;

export async function handleTraverse(
  args: TraverseInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const outcome = await resolveEntity(deps.graph, args.start);

  if (isResolveError(outcome)) {
    return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
  }

  const { entity } = outcome;
  const maxDepth = args.max_depth ?? 3;
  const maxNodes = Math.min(args.max_nodes ?? 100, MAX_NODES_CAP);
  const filterTypes = args.relation_types ? new Set(args.relation_types) : null;

  // Load architecture config if stop_at_boundary is requested
  let archConfig: ArchitectureConfig | null = null;
  let startLayer: string | null = null;
  if (args.stop_at_boundary) {
    archConfig = await loadArchConfig(deps.flowlensDir);
    if (archConfig) {
      startLayer = resolveLayer(entity, archConfig);
    }
  }

  const nodes: TraverseNode[] = [];
  const edges: TraverseEdge[] = [];
  const stoppedAtBoundaries: string[] = [];
  const visited = new Set<string>([entity.id]);
  const visitedEdges = new Set<string>();
  let frontier = [entity.id];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && nodes.length < maxNodes; depth++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      if (nodes.length >= maxNodes) break;

      const edgeSets = await getDirectedEdges(deps, nodeId, args.direction);

      for (const { rel, targetId, dir } of edgeSets) {
        if (nodes.length >= maxNodes) break;
        if (visitedEdges.has(rel.id)) continue;
        if (filterTypes && !filterTypes.has(rel.type)) continue;

        visitedEdges.add(rel.id);
        edges.push({ relation: rel, direction: dir });

        if (visited.has(targetId)) continue;
        visited.add(targetId);

        const targetEntity = await deps.graph.getNode(targetId);
        if (!targetEntity) continue;

        // Check layer boundary
        if (archConfig && startLayer !== null) {
          const targetLayer = resolveLayer(targetEntity, archConfig);
          if (targetLayer !== null && targetLayer !== startLayer) {
            stoppedAtBoundaries.push(targetEntity.qualified_name);
            continue; // Don't expand further but still record the edge
          }
        }

        nodes.push({
          entity: targetEntity,
          depth,
          layer: archConfig ? resolveLayer(targetEntity, archConfig) : undefined,
        });
        nextFrontier.push(targetId);
      }
    }

    frontier = nextFrontier;
  }

  const data: TraverseResult = {
    start: entity,
    nodes,
    edges,
    stopped_at_boundaries: stoppedAtBoundaries,
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxNodes,
    actualCount: nodes.length,
  }));
}

interface DirectedEdge {
  rel: Relation;
  targetId: string;
  dir: 'inbound' | 'outbound';
}

async function getDirectedEdges(
  deps: ServerDependencies,
  nodeId: string,
  direction: 'inbound' | 'outbound' | 'both',
): Promise<DirectedEdge[]> {
  const results: DirectedEdge[] = [];

  if (direction === 'outbound' || direction === 'both') {
    const out = await deps.graph.getEdgesFrom(nodeId);
    for (const rel of out) {
      results.push({ rel, targetId: rel.to, dir: 'outbound' });
    }
  }

  if (direction === 'inbound' || direction === 'both') {
    const inc = await deps.graph.getEdgesTo(nodeId);
    for (const rel of inc) {
      results.push({ rel, targetId: rel.from, dir: 'inbound' });
    }
  }

  return results;
}

async function loadArchConfig(flowlensDir: string): Promise<ArchitectureConfig | null> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as ArchitectureConfig;
}

export function registerTraverse(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'traverse',
    {
      description:
        'BFS walk from a starting entity following inbound, outbound, or both directions with depth and node limits.',
      inputSchema: {
        start: z.string().describe('Starting entity identifier'),
        direction: z.enum(['inbound', 'outbound', 'both']).describe('Traversal direction'),
        relation_types: z.array(z.string()).optional().describe('Filter by relation types'),
        max_depth: z.number().optional().default(3).describe('Max traversal depth (default 3)'),
        max_nodes: z.number().optional().default(100).describe('Max nodes to return (default 100, max 500)'),
        stop_at_boundary: z.boolean().optional().default(false).describe('Stop at architecture layer boundaries'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleTraverse(args as TraverseInput, deps),
  );
}
