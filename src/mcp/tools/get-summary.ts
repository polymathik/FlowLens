/**
 * get_summary tool — high-level overview of the indexed codebase: entity and
 * relation counts, languages, top directory modules, quality, layers and
 * file-level cycle count. Served from the cached graph view.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDependencies } from '../../contracts/mcp/server.js';
import { AnalysisToolSchemas, type GetSummaryInput, type GetSummaryOutput } from '../../contracts/mcp/tools.js';
import { countEntitiesByLayer } from '../../analysis/layer-stats.js';
import { moduleOfEntity } from '../../analysis/module-path.js';
import { buildResponse, toMCPContent, type ToolResult } from '../response-builder.js';
import { openView } from '../tool-runtime.js';
import { cachedCycles, optionalArch } from '../analysis-cache.js';
import type { GraphView } from '../graph-view.js';

const TOP_MODULES = 10;

export async function handleGetSummary(_args: GetSummaryInput, deps: ServerDependencies): Promise<ToolResult> {
  const view = await openView(deps);
  const arch = await optionalArch(deps.flowlensDir, view);
  const stats = view.cached('summary-stats', () => computeStats(view));

  const layers = arch
    ? (() => {
      const { counts } = countEntitiesByLayer(view.nodes, arch.config, arch.layerMap);
      return arch.config.layers.map((l) => ({ name: l.name, entity_count: counts.get(l.name) ?? 0 }));
    })()
    : [];

  const data: GetSummaryOutput = {
    ...stats,
    layers,
    cycle_count: cachedCycles(view, { granularity: 'file' }, arch).length,
    last_indexed: view.lastIndexed,
  };
  return toMCPContent(buildResponse(data, view.lastIndexed));
}

function computeStats(view: GraphView) {
  const entities: Record<string, number> = {};
  const languages: Record<string, { files: number; entities: number }> = {};
  const moduleCounts = new Map<string, number>();
  let qualitySum = 0;
  let qualityCount = 0;

  for (const e of view.nodes) {
    entities[e.kind] = (entities[e.kind] ?? 0) + 1;
    if (e.kind === 'module') continue; // directory entities have no language/module of their own
    const lang = (languages[e.language] ??= { files: 0, entities: 0 });
    lang.entities++;
    if (e.kind === 'file') lang.files++;
    const mod = moduleOfEntity(e);
    moduleCounts.set(mod, (moduleCounts.get(mod) ?? 0) + 1);
    if (e.metrics?.quality_score !== undefined) {
      qualitySum += e.metrics.quality_score;
      qualityCount++;
    }
  }

  const relations: Record<string, number> = {};
  for (const r of view.edges) relations[r.type] = (relations[r.type] ?? 0) + 1;

  const top_modules = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_MODULES)
    .map(([path, entity_count]) => ({ path, entity_count }));

  return {
    entities,
    relations,
    languages,
    top_modules,
    average_quality_score: qualityCount > 0 ? Math.round((qualitySum / qualityCount) * 10) / 10 : 0,
  };
}

export function registerGetSummary(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_summary',
    {
      description:
        'High-level overview of the indexed codebase: entity counts, relations, languages, top modules, quality, layers, and cycles.',
      inputSchema: AnalysisToolSchemas.GetSummaryInputShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => handleGetSummary(args, deps),
  );
}
