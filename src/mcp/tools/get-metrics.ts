/**
 * get_metrics tool — metrics for one entity, or entities ranked by a metric.
 *
 * Coupling metrics (afferent/efferent/instability) are query-time only, so
 * they are computed from the cached graph view with the shared formula in
 * `metrics/coupling.ts`. `quality_score` ranks ascending (worst first); all
 * other fields rank descending.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import type { Entity, EntityMetrics } from '../../contracts/entities.js';
import {
  ANALYSIS_LIMITS, AnalysisToolSchemas,
  type Detail, type GetMetricsInput, type GetMetricsOutput, type MetricSortField, type MetricsEntry,
} from '../../contracts/mcp/tools.js';
import { computeCouplingMetrics } from '../../metrics/coupling.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { DEFAULT_DETAIL, keyMetrics, round } from '../entity-view.js';
import { entityCanvasUrl, openView, resolveOrError } from '../tool-runtime.js';
import { viewAsGraphStore, type GraphView } from '../graph-view.js';

const ASCENDING: ReadonlySet<MetricSortField> = new Set(['quality_score']);

async function withCoupling(view: GraphView, e: Entity): Promise<EntityMetrics> {
  // Shared coupling formula from metrics/coupling.ts, run on the cached view.
  const coupling = await computeCouplingMetrics(e.id, view.cached('store-facade', () => viewAsGraphStore(view)));
  return { line_count: 0, ...e.metrics, ...coupling, instability: round(coupling.instability ?? 0) };
}

function toEntry(e: Entity, metrics: EntityMetrics, sortBy: MetricSortField, detail: Detail): MetricsEntry {
  const shown = detail === 'full'
    ? metrics
    : { ...keyMetrics(metrics), line_count: metrics.line_count, [sortBy]: metrics[sortBy] };
  return {
    entity_id: e.id,
    entity_name: e.name,
    qualified_name: e.qualified_name,
    entity_kind: e.kind,
    file: e.file,
    line: e.location?.line_start ?? 0,
    metrics: shown,
  };
}

export async function handleGetMetrics(args: GetMetricsInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const limit = clampLimit(args.max_results, ANALYSIS_LIMITS.metrics);
  const sortBy: MetricSortField = args.sort_by ?? 'cognitive_complexity';
  const detail = args.detail ?? DEFAULT_DETAIL;

  if (args.entity) {
    const resolved = resolveOrError(view, args.entity);
    if (resolved.error) return resolved.error;
    const { entity } = resolved;
    const metrics = await withCoupling(view, entity);
    const data: GetMetricsOutput = {
      sort_by: sortBy,
      entries: [toEntry(entity, metrics, sortBy, 'full')],
      summary: buildSummary([{ entity, metrics }]),
    };
    return toMCPContent(buildResponse(data, view.lastIndexed, {
      page: { total: 1, returned: 1, limit },
      detail,
      canvas_url: entityCanvasUrl(entity, 'complexity', deps),
    }));
  }

  const candidates = view.nodes
    .filter((e) => (!args.kind || e.kind === args.kind) && e.metrics && hasNonTrivialMetrics(e.metrics));
  const rows: Array<{ entity: Entity; metrics: EntityMetrics }> = [];
  for (const entity of candidates) rows.push({ entity, metrics: await withCoupling(view, entity) });

  const dir = ASCENDING.has(sortBy) ? 1 : -1;
  rows.sort((a, b) => {
    const av = a.metrics[sortBy];
    const bv = b.metrics[sortBy];
    if (av === undefined || bv === undefined) return av === bv ? 0 : av === undefined ? 1 : -1; // missing last
    return dir * (av - bv) || a.entity.qualified_name.localeCompare(b.entity.qualified_name);
  });

  const { items, page } = paginate(rows, limit);
  const data: GetMetricsOutput = {
    sort_by: sortBy,
    entries: items.map((r) => toEntry(r.entity, r.metrics, sortBy, detail)),
    summary: buildSummary(rows),
  };
  return toMCPContent(buildResponse(data, view.lastIndexed, { page, detail }));
}

function hasNonTrivialMetrics(m: EntityMetrics): boolean {
  return (m.cognitive_complexity ?? 0) > 0 || (m.cyclomatic_complexity ?? 0) > 0 || m.quality_score !== undefined;
}

function buildSummary(rows: Array<{ entity: Entity; metrics: EntityMetrics }>): GetMetricsOutput['summary'] {
  const quality = rows.filter((r) => r.metrics.quality_score !== undefined);
  const avgQuality = quality.length > 0
    ? Math.round((quality.reduce((s, r) => s + r.metrics.quality_score!, 0) / quality.length) * 10) / 10
    : null;

  let highest: { entity: Entity; cc: number } | null = null;
  for (const r of rows) {
    const cc = r.metrics.cognitive_complexity ?? 0;
    if (cc > (highest?.cc ?? 0)) highest = { entity: r.entity, cc };
  }

  const bugs = rows.filter((r) => r.metrics.halstead_bugs !== undefined);
  const bugDensity = bugs.length > 0 ? round(bugs.reduce((s, r) => s + r.metrics.halstead_bugs!, 0) / bugs.length) : 0;

  // Only entities coupled in both directions — a pure leaf (Ce only) is trivially "unstable".
  const mostUnstable = rows
    .filter((r) => (r.metrics.afferent_coupling ?? 0) > 0 && (r.metrics.efferent_coupling ?? 0) > 0)
    .sort((a, b) => (b.metrics.instability ?? 0) - (a.metrics.instability ?? 0)
      || (b.metrics.efferent_coupling ?? 0) - (a.metrics.efferent_coupling ?? 0))
    .slice(0, 5)
    .map((r) => ({ name: r.entity.qualified_name, instability: r.metrics.instability ?? 0 }));

  return {
    avg_quality: avgQuality,
    highest_complexity_entity: highest?.entity.qualified_name ?? null,
    bug_density: bugDensity,
    most_unstable: mostUnstable,
  };
}

export function registerGetMetrics(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_metrics',
    {
      description:
        'Code metrics for one entity, or entities ranked by a metric (complexity, quality, Halstead, coupling, churn, hotspot score).',
      inputSchema: AnalysisToolSchemas.GetMetricsInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetMetrics(args, deps),
  );
}
