/**
 * get_layer_map tool — the architecture layer map with entity and violation
 * counts per layer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import { AnalysisToolSchemas, type GetLayerMapInput, type GetLayerMapOutput } from '../../contracts/mcp/tools.js';
import { countEntitiesByLayer, countViolationsByLayer } from '../../analysis/layer-stats.js';
import { buildResponse, toMCPContent, type ToolResult } from '../response-builder.js';
import { archOrError, openView } from '../tool-runtime.js';
import { cachedViolations } from '../analysis-cache.js';

export async function handleGetLayerMap(_args: GetLayerMapInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const arch = await archOrError(deps, view);
  if (arch.error) return arch.error;

  const { counts, unassigned } = countEntitiesByLayer(view.nodes, arch.config, arch.layerMap);
  const violations = cachedViolations(view, arch);
  const violationCounts = countViolationsByLayer(violations, arch.config);

  const layers = arch.config.layers.map((l) => ({
    name: l.name,
    include: l.include,
    entity_count: counts.get(l.name) ?? 0,
    violation_count: violationCounts.get(l.name) ?? 0,
    may_only_access: l.may_only_access ?? [],
    must_not_access: l.must_not_access ?? [],
  }));

  const data: GetLayerMapOutput = {
    version: arch.config.version,
    inferred_by: arch.config.inferred_by,
    layers,
    unassigned_count: unassigned,
    summary: {
      total_layers: layers.length,
      total_entities_assigned: layers.reduce((sum, l) => sum + l.entity_count, 0),
      total_violations: violations.length,
    },
  };
  return toMCPContent(buildResponse(data, view.lastIndexed));
}

export function registerGetLayerMap(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_layer_map',
    {
      description: 'Returns the architecture layer map with entity counts and violation counts per layer.',
      inputSchema: AnalysisToolSchemas.GetLayerMapInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetLayerMap(args, deps),
  );
}
