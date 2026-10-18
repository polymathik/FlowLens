/**
 * check_architecture tool — validates the graph against the layer rules in
 * architecture.json and reports violations with readable names and rule text.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../server.js';
import {
  ANALYSIS_LIMITS, AnalysisToolSchemas,
  type CheckArchitectureInput, type CheckArchitectureOutput,
} from '../../contracts/mcp/tools.js';
import { countEntitiesByLayer, countViolationsByLayer } from '../../analysis/layer-stats.js';
import { isInScope } from '../../analysis/module-path.js';
import { buildResponse, paginate, toMCPContent, type ToolResult } from '../response-builder.js';
import { clampLimit } from '../limits.js';
import { archOrError, openView } from '../tool-runtime.js';
import { cachedViolations } from '../analysis-cache.js';

export async function handleCheckArchitecture(
  args: CheckArchitectureInput,
  deps: ServerDependencies,
): Promise<ToolResult> {
  const view = await openView(deps);
  const arch = await archOrError(deps, view);
  if (arch.error) return arch.error;

  const limit = clampLimit(args.max_results, ANALYSIS_LIMITS.architecture);
  const violations = cachedViolations(view, arch).filter((v) => isInScope(v.location.file, args.scope));

  const entityCounts = countEntitiesByLayer(view.nodes, arch.config, arch.layerMap).counts;
  const violationCounts = countViolationsByLayer(violations, arch.config);
  const layers = arch.config.layers.map((l) => ({
    name: l.name,
    entity_count: entityCounts.get(l.name) ?? 0,
    violation_count: violationCounts.get(l.name) ?? 0,
  }));

  const { items, page } = paginate(violations, limit);
  const data: CheckArchitectureOutput = {
    violations: items,
    layers,
    summary: {
      total_violations: violations.length,
      layers_with_violations: layers.filter((l) => l.violation_count > 0).map((l) => l.name),
    },
  };
  return toMCPContent(buildResponse(data, view.lastIndexed, { page }));
}

export function registerCheckArchitecture(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'check_architecture',
    {
      description: 'Validates the codebase against architecture layer rules and reports violations.',
      inputSchema: AnalysisToolSchemas.CheckArchitectureInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleCheckArchitecture(args, deps),
  );
}
