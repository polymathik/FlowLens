/**
 * get_dependents tool — everything that depends on an entity (inbound
 * relations), optionally the full transitive closure.
 *
 * Structural `contain` edges are excluded unless explicitly requested: a file
 * containing a class is not a dependent of it.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import {
  LIMITS, EntityToolSchemas,
  type DependentEntry, type GetDependentsInput, type GetDependentsOutput,
} from '../../contracts/mcp/tools.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL, round, toEntityView } from '../entity-view.js';
import { entityCanvasUrl, openView, resolveOrError } from '../tool-runtime.js';
import type { GraphView } from '../graph-view.js';

interface Hit {
  id: string;
  rel: Relation;
  depth: number;
}

/** BFS over inbound edges; each dependent is reported once, at its shallowest depth. */
export function collectDependents(
  view: GraphView,
  rootId: string,
  accept: (type: RelationType) => boolean,
  transitive: boolean,
): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const rel of view.edgesTo(nodeId)) {
        if (!accept(rel.type) || seen.has(rel.from) || !view.byId.has(rel.from)) continue;
        seen.add(rel.from);
        hits.push({ id: rel.from, rel, depth });
        next.push(rel.from);
      }
    }
    if (!transitive) break;
    frontier = next;
  }
  return hits;
}

export async function handleGetDependents(args: GetDependentsInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const resolved = resolveOrError(view, args.entity);
  if (resolved.error) return resolved.error;
  const { entity } = resolved;

  const limit = clampLimit(args.max_results, LIMITS.dependents);
  const detail = args.detail ?? DEFAULT_DETAIL;
  const types = args.relation_types ? new Set<string>(args.relation_types) : null;
  const accept = (t: RelationType) => (types ? types.has(t) : t !== 'contain');

  const hits = collectDependents(view, entity.id, accept, args.include_transitive ?? false);
  const direct = hits.filter((h) => h.depth === 1).length;
  const others = Math.max(view.nodes.length - 1, 1);

  const { items, page } = paginate(hits, limit);
  const dependents: DependentEntry[] = items.map((h) => ({
    entity: toEntityView(view.byId.get(h.id)!, detail),
    relation_type: h.rel.type,
    depth: h.depth,
    is_direct: h.depth === 1,
    line: h.rel.location.line,
    ...(detail === 'full'
      ? { location: { file: h.rel.location.file, line: h.rel.location.line }, relation: h.rel }
      : {}),
  }));

  const data: GetDependentsOutput = {
    entity: toEntityView(entity, detail),
    dependents,
    direct_count: direct,
    transitive_count: hits.length - direct,
    risk_score: round(Math.min(hits.length / others, 1)),
  };

  return toMCPContent(buildResponse(data, view.lastIndexed, {
    page, detail, canvas_url: entityCanvasUrl(entity, undefined, deps),
  }));
}

export function registerGetDependents(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_dependents',
    {
      description:
        'Entities that depend on a given entity (who breaks if it changes), with optional transitive closure and a risk score.',
      inputSchema: EntityToolSchemas.GetDependentsInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetDependents(args, deps),
  );
}
