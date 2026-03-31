/**
 * get_summary tool — returns a high-level overview of the indexed codebase
 * including entity/relation counts, language breakdown, top modules,
 * quality scores, layer structure, and cycle count.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDependencies } from '../server.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { buildResponse, toMCPContent } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface GetSummaryResult {
  entities_by_kind: Record<string, number>;
  relations_by_type: Record<string, number>;
  language_breakdown: Record<string, number>;
  top_modules: Array<{ name: string; entity_count: number }>;
  avg_quality_score: number | null;
  layer_structure: string[];
  cycle_count: number;
  total_entities: number;
  total_relations: number;
  last_indexed: string;
}

export async function handleGetSummary(
  _args: Record<string, never>,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);

  const [allNodes, allEdges] = await Promise.all([
    deps.graph.getAllNodes(),
    deps.graph.getAllEdges(),
  ]);

  // Count entities by kind
  const entitiesByKind: Record<string, number> = {};
  for (const entity of allNodes) {
    entitiesByKind[entity.kind] = (entitiesByKind[entity.kind] ?? 0) + 1;
  }

  // Count relations by type
  const relationsByType: Record<string, number> = {};
  for (const edge of allEdges) {
    relationsByType[edge.type] = (relationsByType[edge.type] ?? 0) + 1;
  }

  // Language breakdown: group file entities by language
  const languageBreakdown: Record<string, number> = {};
  for (const entity of allNodes) {
    if (entity.kind === 'file') {
      languageBreakdown[entity.language] = (languageBreakdown[entity.language] ?? 0) + 1;
    }
  }

  // Top modules: group entities by first directory segment, count
  const moduleCounts = new Map<string, number>();
  for (const entity of allNodes) {
    const parts = entity.file.split('/');
    const moduleName = parts.length > 1 ? parts[0] : entity.file;
    moduleCounts.set(moduleName, (moduleCounts.get(moduleName) ?? 0) + 1);
  }
  const topModules = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, entity_count]) => ({ name, entity_count }));

  // Average quality score
  const withQuality = allNodes.filter(e => e.metrics?.quality_score !== undefined);
  const avgQualityScore = withQuality.length > 0
    ? Math.round(withQuality.reduce((sum, e) => sum + (e.metrics!.quality_score ?? 0), 0) / withQuality.length * 10) / 10
    : null;

  // Layer structure from architecture.json
  const layerStructure = await loadLayerNames(deps.flowlensDir);

  // Cycle count
  let cycleCount = 0;
  try {
    const cycles = await detectCycles(deps.graph, { granularity: 'file' });
    cycleCount = cycles.length;
  } catch {
    // Cycle detection may fail on empty graphs; default to 0
  }

  const data: GetSummaryResult = {
    entities_by_kind: entitiesByKind,
    relations_by_type: relationsByType,
    language_breakdown: languageBreakdown,
    top_modules: topModules,
    avg_quality_score: avgQualityScore,
    layer_structure: layerStructure,
    cycle_count: cycleCount,
    total_entities: allNodes.length,
    total_relations: allEdges.length,
    last_indexed: lastIndexed,
  };

  return toMCPContent(buildResponse(data, lastIndexed));
}

async function loadLayerNames(flowlensDir: string): Promise<string[]> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return [];
  try {
    const content = await readFile(path, 'utf-8');
    const config = JSON.parse(content) as ArchitectureConfig;
    return config.layers.map(l => l.name);
  } catch {
    return [];
  }
}

export function registerGetSummary(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_summary',
    {
      description:
        'Returns a high-level overview of the indexed codebase: entity counts, relations, languages, quality, layers, and cycles.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => handleGetSummary({} as Record<string, never>, deps),
  );
}
