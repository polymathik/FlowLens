/**
 * traverse tool — BFS walk from a starting entity over inbound, outbound or
 * both directions, with depth/node limits and optional layer boundaries.
 *
 * All reachable nodes within max_depth are computed first (in memory), then
 * paginated: total_count is the exact reachable count. With
 * stop_at_boundary, an edge whose endpoint resolves to a different layer
 * than the node it was reached from is a boundary crossing: the far node is
 * returned (flagged `boundary`) but not expanded.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../server.js';
import type { Relation } from '../../contracts/relations.js';
import {
  LIMITS, EntityToolSchemas,
  type TraverseEdge, type TraverseInput, type TraverseNode, type TraverseOutput,
} from '../../contracts/mcp/tools.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL, toEntityView } from '../entity-view.js';
import { archOrError, entityCanvasUrl, openView, resolveOrError } from '../tool-runtime.js';

interface Reached {
  id: string;
  depth: number;
  layer: string | null;
  boundary: boolean;
  fromLayer: string | null;
}

export async function handleTraverse(args: TraverseInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const resolved = resolveOrError(view, args.start);
  if (resolved.error) return resolved.error;
  const { entity } = resolved;

  const maxDepth = Math.min(Math.max(args.max_depth ?? LIMITS.traverse.depthDefault, 1), LIMITS.traverse.depthCap);
  const limit = clampLimit(args.max_nodes, LIMITS.traverse);
  const detail = args.detail ?? DEFAULT_DETAIL;
  const filter = args.relation_types ? new Set<string>(args.relation_types) : null;
  const direction = args.direction;

  let layerOf: ((id: string) => string | null) | null = null;
  if (args.stop_at_boundary) {
    const arch = await archOrError(deps, view);
    if (arch.error) return arch.error;
    layerOf = (id) => arch.layerMap.get(id) ?? null;
  }

  const reached: Reached[] = [];
  const byId = new Map<string, Reached>();
  const traversed: Array<{ rel: Relation; dir: 'inbound' | 'outbound' }> = [];
  const seenRels = new Set<string>();
  const startLayer = layerOf ? layerOf(entity.id) : null;
  let frontier = [entity.id];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      const nodeLayer = layerOf ? (nodeId === entity.id ? startLayer : byId.get(nodeId)!.layer) : null;
      for (const { rel, targetId, dir } of directedEdges(view, nodeId, direction)) {
        if (seenRels.has(rel.id) || (filter && !filter.has(rel.type)) || !view.byId.has(targetId)) continue;
        seenRels.add(rel.id);
        traversed.push({ rel, dir });
        if (targetId === entity.id || byId.has(targetId)) continue;

        const layer = layerOf ? layerOf(targetId) : null;
        const boundary = layerOf !== null && layer !== nodeLayer;
        const r: Reached = { id: targetId, depth, layer, boundary, fromLayer: nodeLayer };
        reached.push(r);
        byId.set(targetId, r);
        if (!boundary) next.push(targetId);
      }
    }
    frontier = next;
  }

  const { items, page } = paginate(reached, limit);
  const included = new Set<string>([entity.id, ...items.map((r) => r.id)]);

  const nodes: TraverseNode[] = items.map((r) => ({
    // Summary traversal nodes omit metrics: the walk's shape is the point.
    entity: toEntityView(view.byId.get(r.id)!, detail, { metrics: detail === 'full' }),
    depth: r.depth,
    ...(layerOf ? { layer: r.layer } : {}),
    ...(r.boundary ? { boundary: true as const } : {}),
  }));
  const edges: TraverseEdge[] = traversed
    .filter(({ rel }) => included.has(rel.from) && included.has(rel.to))
    .map(({ rel, dir }) => ({
      from: rel.from, to: rel.to, type: rel.type, direction: dir,
      ...(detail === 'full' ? { relation: rel } : {}),
    }));

  const data: TraverseOutput = {
    start: toEntityView(entity, detail),
    ...(layerOf ? { start_layer: startLayer } : {}),
    nodes,
    edges,
    stopped_at_boundaries: items.filter((r) => r.boundary).map((r) => ({
      entity: view.byId.get(r.id)!.qualified_name,
      from_layer: r.fromLayer,
      to_layer: r.layer,
    })),
  };

  return toMCPContent(buildResponse(data, view.lastIndexed, {
    page, detail, canvas_url: entityCanvasUrl(entity),
  }));
}

function* directedEdges(
  view: Awaited<ReturnType<typeof openView>>,
  nodeId: string,
  direction: 'inbound' | 'outbound' | 'both',
): Generator<{ rel: Relation; targetId: string; dir: 'inbound' | 'outbound' }> {
  if (direction !== 'inbound') for (const rel of view.edgesFrom(nodeId)) yield { rel, targetId: rel.to, dir: 'outbound' };
  if (direction !== 'outbound') for (const rel of view.edgesTo(nodeId)) yield { rel, targetId: rel.from, dir: 'inbound' };
}

export function registerTraverse(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'traverse',
    {
      description:
        'BFS walk from an entity (inbound, outbound or both) with depth/node limits; optionally stops at architecture layer boundaries.',
      inputSchema: EntityToolSchemas.TraverseInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleTraverse(args, deps),
  );
}
