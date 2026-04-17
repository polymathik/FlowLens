/**
 * get_metrics tool — queries metrics for individual entities or
 * aggregated across the codebase, sorted by a chosen metric field.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { Entity, EntityKind, EntityMetrics } from '../../contracts/entities.js';
import { resolveEntity, isResolveError } from '../entity-resolver.js';
import { computeCouplingMetrics } from '../../metrics/coupling.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';
import { buildCanvasUrl } from '../../contracts/canvas-links.js';

export interface GetMetricsInput {
  entity?: string;
  kind?: string;
  sort_by?: string;
  max_results?: number;
}

export interface MetricsEntry {
  entity_id: string;
  entity_name: string;
  entity_kind: EntityKind;
  file: string;
  metrics: EntityMetrics;
}

export interface MetricsSummary {
  avg_quality: number | null;
  highest_complexity_entity: string | null;
  bug_density: number;
  most_unstable: Array<{ name: string; instability: number }>;
}

export interface GetMetricsResult {
  entries: MetricsEntry[];
  summary: MetricsSummary;
}

const MAX_RESULTS_CAP = 250;
const SORTABLE_FIELDS = [
  'cognitive_complexity', 'cyclomatic_complexity', 'quality_score',
  'halstead_volume', 'halstead_difficulty', 'halstead_bugs',
  'line_count', 'instability',
] as const;

type SortField = typeof SORTABLE_FIELDS[number];

export async function handleGetMetrics(
  args: GetMetricsInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);
  const sortBy = (args.sort_by ?? 'cognitive_complexity') as SortField;

  // Single-entity mode
  if (args.entity) {
    const outcome = await resolveEntity(deps.graph, args.entity);
    if (isResolveError(outcome)) {
      return toMCPError(outcome.error, outcome.suggestions, lastIndexed);
    }
    const { entity } = outcome;
    const coupling = await computeCouplingMetrics(entity.id, deps.graph);
    const mergedMetrics: EntityMetrics = { ...entity.metrics, ...coupling } as EntityMetrics;

    const entry: MetricsEntry = {
      entity_id: entity.id,
      entity_name: entity.name,
      entity_kind: entity.kind,
      file: entity.file,
      metrics: mergedMetrics,
    };

    return toMCPContent(buildResponse(
      { entries: [entry], summary: buildSummary([entity]) },
      lastIndexed,
      {
        canvas_url: buildCanvasUrl({
          kind: entity.kind === 'file' ? 'file' : 'entity',
          identifier: entity.qualified_name,
          overlay: 'complexity',
        }),
      },
    ));
  }

  // Multi-entity mode: all entities, optionally filtered by kind
  const allNodes = await deps.graph.getAllNodes();
  let filtered = allNodes;

  if (args.kind) {
    filtered = filtered.filter(e => e.kind === args.kind);
  }

  // Filter to entities with meaningful metrics
  filtered = filtered.filter(e => e.metrics && hasNonTrivialMetrics(e.metrics));

  // Sort by the requested metric field (descending)
  filtered.sort((a, b) => {
    const aVal = getMetricValue(a.metrics, sortBy);
    const bVal = getMetricValue(b.metrics, sortBy);
    return bVal - aVal;
  });

  const totalCount = filtered.length;
  const sliced = filtered.slice(0, maxResults);

  const entries: MetricsEntry[] = sliced.map(e => ({
    entity_id: e.id,
    entity_name: e.name,
    entity_kind: e.kind,
    file: e.file,
    metrics: e.metrics!,
  }));

  const data: GetMetricsResult = {
    entries,
    summary: buildSummary(filtered),
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: entries.length,
    total_count: totalCount,
  }));
}

function hasNonTrivialMetrics(m: EntityMetrics): boolean {
  return (m.cognitive_complexity !== undefined && m.cognitive_complexity > 0) ||
    (m.cyclomatic_complexity !== undefined && m.cyclomatic_complexity > 0) ||
    (m.quality_score !== undefined);
}

function getMetricValue(metrics: EntityMetrics | undefined, field: SortField): number {
  if (!metrics) return 0;
  return (metrics[field as keyof EntityMetrics] as number) ?? 0;
}

function buildSummary(entities: Entity[]): MetricsSummary {
  const withQuality = entities.filter(e => e.metrics?.quality_score !== undefined);
  const avgQuality = withQuality.length > 0
    ? Math.round(withQuality.reduce((sum, e) => sum + (e.metrics!.quality_score ?? 0), 0) / withQuality.length * 10) / 10
    : null;

  // Highest complexity
  let highestCC: Entity | null = null;
  for (const e of entities) {
    const cc = e.metrics?.cognitive_complexity ?? 0;
    if (cc > (highestCC?.metrics?.cognitive_complexity ?? 0)) {
      highestCC = e;
    }
  }

  // Bug density: sum halstead_bugs / count of entities with halstead_bugs
  const withBugs = entities.filter(e => e.metrics?.halstead_bugs !== undefined);
  const totalBugs = withBugs.reduce((sum, e) => sum + (e.metrics!.halstead_bugs ?? 0), 0);
  const bugDensity = withBugs.length > 0
    ? Math.round((totalBugs / withBugs.length) * 1000) / 1000
    : 0;

  // Most unstable: top 5 by instability
  const withInstability = entities
    .filter(e => e.metrics?.instability !== undefined && e.metrics.instability > 0)
    .sort((a, b) => (b.metrics!.instability ?? 0) - (a.metrics!.instability ?? 0))
    .slice(0, 5)
    .map(e => ({ name: e.name, instability: e.metrics!.instability! }));

  return {
    avg_quality: avgQuality,
    highest_complexity_entity: highestCC?.name ?? null,
    bug_density: bugDensity,
    most_unstable: withInstability,
  };
}

export function registerGetMetrics(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_metrics',
    {
      description:
        'Queries code metrics for a specific entity or across the codebase, sorted by any metric field.',
      inputSchema: {
        entity: z.string().optional().describe('Entity identifier (omit for aggregate view)'),
        kind: z.string().optional().describe('Filter by entity kind (class, function, etc.)'),
        sort_by: z.string().optional().default('cognitive_complexity')
          .describe('Metric field to sort by (descending)'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetMetrics(args as GetMetricsInput, deps),
  );
}
