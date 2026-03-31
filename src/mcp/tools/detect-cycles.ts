/**
 * detect_cycles tool — delegates to the cycle-detector analysis module
 * and builds a summary with counts by severity and granularity.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerDependencies } from '../server.js';
import type { CycleGranularity, CycleSeverity, DetectedCycle } from '../../contracts/analysis/cycles.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { buildResponse, toMCPContent } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface DetectCyclesInput {
  granularity?: string;
  scope?: string;
  relation_types?: string[];
  severity_threshold?: string;
  max_results?: number;
}

export interface DetectCyclesResult {
  cycles: DetectedCycle[];
  summary: {
    total_cycles: number;
    by_severity: Record<string, number>;
    by_granularity: Record<string, number>;
  };
}

const MAX_RESULTS_CAP = 250;

export async function handleDetectCycles(
  args: DetectCyclesInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const granularity = (args.granularity ?? 'all') as CycleGranularity;
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);

  const granularities: CycleGranularity[] = granularity === 'all'
    ? ['file', 'module', 'function']
    : [granularity];

  let allCycles: DetectedCycle[] = [];

  for (const g of granularities) {
    const cycles = await detectCycles(deps.graph, {
      granularity: g,
      scope: args.scope,
      relation_types: args.relation_types as any,
      severity_threshold: args.severity_threshold as CycleSeverity | undefined,
    });
    allCycles.push(...cycles);
  }

  // Build summary counts
  const bySeverity: Record<string, number> = {};
  const byGranularity: Record<string, number> = {};

  for (const cycle of allCycles) {
    bySeverity[cycle.severity] = (bySeverity[cycle.severity] ?? 0) + 1;
    byGranularity[cycle.granularity] = (byGranularity[cycle.granularity] ?? 0) + 1;
  }

  const totalCycles = allCycles.length;
  const truncated = allCycles.slice(0, maxResults);

  const data: DetectCyclesResult = {
    cycles: truncated,
    summary: {
      total_cycles: totalCycles,
      by_severity: bySeverity,
      by_granularity: byGranularity,
    },
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: truncated.length,
    total_count: totalCycles,
  }));
}

export function registerDetectCycles(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'detect_cycles',
    {
      description:
        'Detects dependency cycles in the codebase at file, module, or function granularity.',
      inputSchema: {
        granularity: z.enum(['file', 'module', 'function', 'all']).optional().default('all')
          .describe('Cycle detection granularity'),
        scope: z.string().optional().describe('Scope to a file path prefix'),
        relation_types: z.array(z.string()).optional().describe('Filter by relation types'),
        severity_threshold: z.enum(['low', 'medium', 'high']).optional()
          .describe('Minimum severity threshold'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDetectCycles(args as DetectCyclesInput, deps),
  );
}
