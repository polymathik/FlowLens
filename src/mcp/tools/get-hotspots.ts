/**
 * get_hotspots tool — identifies code hotspots by combining git churn
 * data with cognitive complexity. High churn + high complexity = hotspot.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { EntityKind } from '../../contracts/entities.js';
import { computeChurn } from '../../analysis/churn-analyzer.js';
import { computeHotspots } from '../../analysis/hotspot-analyzer.js';
import { buildResponse, toMCPContent } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface GetHotspotsInput {
  kind?: string;
  min_score?: number;
  max_results?: number;
}

export interface GetHotspotsResult {
  hotspots: Array<{
    entity_id: string;
    entity_name: string;
    entity_kind: EntityKind;
    file: string;
    hotspot_score: number;
    churn_rate: number;
    cognitive_complexity: number;
    dependent_count: number;
  }>;
  summary: {
    total_hotspots: number;
    avg_hotspot_score: number;
    highest_hotspot: string | null;
  };
}

const MAX_RESULTS_CAP = 250;

export async function handleGetHotspots(
  args: GetHotspotsInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const maxResults = Math.min(args.max_results ?? 20, MAX_RESULTS_CAP);

  const churnData = await computeChurn(deps.rootDir);

  const hotspots = await computeHotspots(deps.graph, churnData, {
    kind: args.kind as EntityKind | undefined,
    min_score: args.min_score,
    max_results: maxResults,
  });

  const totalCount = hotspots.length;
  const avgScore = totalCount > 0
    ? Math.round(hotspots.reduce((sum, h) => sum + h.hotspot_score, 0) / totalCount * 100) / 100
    : 0;

  const data: GetHotspotsResult = {
    hotspots,
    summary: {
      total_hotspots: totalCount,
      avg_hotspot_score: avgScore,
      highest_hotspot: hotspots[0]?.entity_name ?? null,
    },
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: hotspots.length,
    total_count: totalCount,
  }));
}

export function registerGetHotspots(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_hotspots',
    {
      description:
        'Identifies code hotspots by combining git churn rate with cognitive complexity.',
      inputSchema: {
        kind: z.string().optional().describe('Filter by entity kind (function, class, etc.)'),
        min_score: z.number().optional().describe('Minimum hotspot score threshold'),
        max_results: z.number().optional().default(20).describe('Max results (default 20, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetHotspots(args as GetHotspotsInput, deps),
  );
}
