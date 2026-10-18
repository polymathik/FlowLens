/**
 * get_hotspots tool — code hotspots: git churn rate × cognitive complexity.
 * Only entities with a positive score are listed unless include_zero is set;
 * last_changed is the real date of the last commit touching the file.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import {
  ANALYSIS_LIMITS, AnalysisToolSchemas,
  type GetHotspotsInput, type GetHotspotsOutput,
} from '../../contracts/mcp/tools.js';
import type { FileChurnData } from '../../contracts/analysis/churn.js';
import { computeChurn } from '../../analysis/churn-analyzer.js';
import { computeHotspotsInData } from '../../analysis/hotspot-analyzer.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { round } from '../entity-view.js';
import { openView } from '../tool-runtime.js';

export const CHURN_PERIOD_DAYS = 90;

export async function handleGetHotspots(args: GetHotspotsInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const limit = clampLimit(args.max_results, ANALYSIS_LIMITS.hotspots);

  // Churn depends on git, not the graph; memoise per graph load (local git call).
  const churn = await view.cached<Promise<Map<string, FileChurnData>>>(
    `churn:${deps.rootDir}`, () => computeChurn(deps.rootDir, { period_days: CHURN_PERIOD_DAYS }),
  );
  const all = computeHotspotsInData(view.nodes, (id) => view.edgesTo(id), churn, {
    kind: args.kind,
    min_score: args.min_score,
    include_zero: args.include_zero,
  }).map((h) => ({ ...h, hotspot_score: round(h.hotspot_score, 4), churn_rate: round(h.churn_rate, 4) }));

  const { items, page } = paginate(all, limit);
  const avg = all.length > 0 ? all.reduce((s, h) => s + h.hotspot_score, 0) / all.length : 0;
  const data: GetHotspotsOutput = {
    hotspots: items,
    summary: {
      total_hotspots: all.length,
      avg_hotspot_score: round(avg, 4),
      highest_hotspot: all[0]?.qualified_name ?? all[0]?.entity_name ?? null,
      churn_period_days: CHURN_PERIOD_DAYS,
    },
  };
  return toMCPContent(buildResponse(data, view.lastIndexed, { page }));
}

export function registerGetHotspots(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_hotspots',
    {
      description: 'Code hotspots: entities ranked by git churn rate × cognitive complexity (positive scores only by default).',
      inputSchema: AnalysisToolSchemas.GetHotspotsInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetHotspots(args, deps),
  );
}
