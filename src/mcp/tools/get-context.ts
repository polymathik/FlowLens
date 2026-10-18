/**
 * get_context tool — the neighbourhood of an entity: relations up to `depth`
 * (BFS, both directions), its metrics and annotations.
 *
 * The full neighbourhood is computed first (in memory, from the cached graph
 * view) and then paginated, so total_count/truncated are exact.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import type { Relation } from '../../contracts/relations.js';
import {
  LIMITS, EntityToolSchemas,
  type GetContextInput, type GetContextOutput, type ContextRelation,
} from '../../contracts/mcp/tools.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL, toEntityView } from '../entity-view.js';
import { entityCanvasUrl, openView, resolveOrError } from '../tool-runtime.js';

/** Safety ceiling on relations explored; beyond it total_count becomes a lower bound. */
export const MAX_EXPLORED_RELATIONS = 50_000;

interface Hit {
  rel: Relation;
  neighbourId: string;
  direction: 'inbound' | 'outbound';
  depth: number;
}

export async function handleGetContext(args: GetContextInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const resolved = resolveOrError(view, args.entity);
  if (resolved.error) return resolved.error;
  const { entity } = resolved;

  const depth = Math.min(Math.max(args.depth ?? LIMITS.context.depthDefault, 1), LIMITS.context.depthCap);
  const limit = clampLimit(args.max_results, LIMITS.context);
  const detail = args.detail ?? DEFAULT_DETAIL;
  const includeMetrics = args.include_metrics ?? true;
  const filter = args.relation_types ? new Set<string>(args.relation_types) : null;

  const hits: Hit[] = [];
  const visitedNodes = new Set<string>([entity.id]);
  const visitedRels = new Set<string>();
  let frontier = [entity.id];
  let capped = false;

  for (let d = 1; d <= depth && frontier.length > 0 && !capped; d++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      const sides: Array<[Relation[], 'outbound' | 'inbound']> = [
        [view.edgesFrom(nodeId), 'outbound'],
        [view.edgesTo(nodeId), 'inbound'],
      ];
      for (const [rels, direction] of sides) {
        for (const rel of rels) {
          if (visitedRels.has(rel.id) || (filter && !filter.has(rel.type))) continue;
          visitedRels.add(rel.id);
          const neighbourId = direction === 'outbound' ? rel.to : rel.from;
          if (!view.byId.has(neighbourId)) continue; // dangling endpoint
          hits.push({ rel, neighbourId, direction, depth: d });
          if (!visitedNodes.has(neighbourId)) {
            visitedNodes.add(neighbourId);
            next.push(neighbourId);
          }
          if (visitedRels.size >= MAX_EXPLORED_RELATIONS) capped = true;
        }
      }
    }
    frontier = next;
  }

  const counts: GetContextOutput['relation_counts'] = { inbound: 0, outbound: 0, by_type: {} };
  for (const h of hits) {
    counts[h.direction]++;
    counts.by_type[h.rel.type] = (counts.by_type[h.rel.type] ?? 0) + 1;
  }

  const { items, page } = paginate(hits, limit, { estimate: capped });
  const relations: ContextRelation[] = items.map((h) => ({
    direction: h.direction,
    relation_type: h.rel.type,
    depth: h.depth,
    entity: toEntityView(view.byId.get(h.neighbourId)!, detail, { metrics: includeMetrics }),
    line: h.rel.location.line,
    ...(detail === 'full'
      ? { location: { file: h.rel.location.file, line: h.rel.location.line }, relation: h.rel }
      : {}),
  }));

  const data: GetContextOutput = {
    // The root entity always carries its complete metrics (when requested).
    entity: {
      ...toEntityView(entity, detail, { metrics: false }),
      ...(includeMetrics && entity.metrics ? { metrics: entity.metrics } : {}),
    },
    relations,
    relation_counts: counts,
    annotations: deps.annotationStore.getForEntity(entity.id),
  };

  return toMCPContent(buildResponse(data, view.lastIndexed, {
    page, detail, canvas_url: entityCanvasUrl(entity, undefined, deps),
  }));
}

export function registerGetContext(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_context',
    {
      description:
        'Neighbourhood of a code entity: inbound/outbound relations up to `depth`, metrics and annotations. '
        + 'Ambiguous names return candidates to retry with.',
      inputSchema: EntityToolSchemas.GetContextInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetContext(args, deps),
  );
}
