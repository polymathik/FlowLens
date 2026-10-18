/**
 * detect_cycles tool — dependency cycles at file, module (directory) or
 * function (call graph) granularity; `all` runs all three. Each cycle has an
 * ordered closed path, its edges, and an explained, layer-aware severity.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../server.js';
import type { CycleGranularity, DetectedCycle } from '../../contracts/analysis/cycles.js';
import {
  ANALYSIS_LIMITS, AnalysisToolSchemas,
  type DetectCyclesInput, type DetectCyclesOutput,
} from '../../contracts/mcp/tools.js';
import { SEVERITY_ORDER } from '../../analysis/cycle-detector.js';
import { normalizeScope } from '../../analysis/module-path.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { openView } from '../tool-runtime.js';
import { cachedCycles, optionalArch } from '../analysis-cache.js';

export async function handleDetectCycles(args: DetectCyclesInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const arch = await optionalArch(deps.flowlensDir, view);
  const granularity = args.granularity ?? 'all';
  const limit = clampLimit(args.max_results, ANALYSIS_LIMITS.cycles);
  const granularities: Array<Exclude<CycleGranularity, 'all'>> =
    granularity === 'all' ? ['file', 'module', 'function'] : [granularity];

  const all: DetectedCycle[] = [];
  for (const g of granularities) {
    all.push(...cachedCycles(view, {
      granularity: g,
      relation_types: args.relation_types,
      scope: normalizeScope(args.scope),
      severity_threshold: args.severity_threshold,
    }, arch));
  }
  all.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.length - b.length);

  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byGranularity: Record<string, number> = Object.fromEntries(granularities.map((g) => [g, 0]));
  for (const c of all) {
    bySeverity[c.severity]++;
    byGranularity[c.granularity] = (byGranularity[c.granularity] ?? 0) + 1;
  }

  const { items, page } = paginate(all, limit);
  const data: DetectCyclesOutput = {
    cycles: items.map(compactCycle),
    summary: { total_cycles: all.length, by_severity: bySeverity, by_granularity: byGranularity },
  };
  return toMCPContent(buildResponse(data, view.lastIndexed, { page }));
}

export const MAX_CYCLE_MEMBERS = 25;

/** Response-size guard: cap member lists, drop labels identical to ids. */
function compactCycle(c: DetectedCycle): DetectedCycle {
  const { path_labels, ...rest } = c;
  const sameLabels = !path_labels || path_labels.every((l, i) => l === c.path?.[i]);
  return {
    ...rest,
    entities: c.entities.slice(0, MAX_CYCLE_MEMBERS),
    ...(sameLabels ? {} : { path_labels }),
  };
}

export function registerDetectCycles(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'detect_cycles',
    {
      description:
        'Detects dependency cycles at file, module (directory) or function granularity, with ordered cycle paths and layer-aware severity.',
      inputSchema: AnalysisToolSchemas.DetectCyclesInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDetectCycles(args, deps),
  );
}
