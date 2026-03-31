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
  entities: Record<string, number>;
  relations: Record<string, number>;
  languages: Record<string, { files: number; entities: number }>;
  top_modules: Array<{ path: string; entity_count: number }>;
  average_quality_score: number;
  layers: Array<{ name: string; entity_count: number }>;
  cycle_count: number;
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
  const entities: Record<string, number> = {};
  for (const entity of allNodes) {
    entities[entity.kind] = (entities[entity.kind] ?? 0) + 1;
  }

  // Count relations by type
  const relations: Record<string, number> = {};
  for (const edge of allEdges) {
    relations[edge.type] = (relations[edge.type] ?? 0) + 1;
  }

  // Language breakdown: compute files and entities per language
  const languages: Record<string, { files: number; entities: number }> = {};
  for (const entity of allNodes) {
    if (!languages[entity.language]) {
      languages[entity.language] = { files: 0, entities: 0 };
    }
    languages[entity.language].entities += 1;
    if (entity.kind === 'file') {
      languages[entity.language].files += 1;
    }
  }

  // Top modules: group entities by first directory segment, count
  const moduleCounts = new Map<string, number>();
  for (const entity of allNodes) {
    const parts = entity.file.split('/');
    const modulePath = parts.length > 1 ? parts[0] : entity.file;
    moduleCounts.set(modulePath, (moduleCounts.get(modulePath) ?? 0) + 1);
  }
  const topModules = [...moduleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, entity_count]) => ({ path, entity_count }));

  // Average quality score
  const withQuality = allNodes.filter(e => e.metrics?.quality_score !== undefined);
  const averageQualityScore = withQuality.length > 0
    ? Math.round(withQuality.reduce((sum, e) => sum + (e.metrics!.quality_score ?? 0), 0) / withQuality.length * 10) / 10
    : 0;

  // Layers from architecture.json
  const layers = await loadLayerInfo(deps.flowlensDir, deps.graph);

  // Cycle count
  let cycleCount = 0;
  try {
    const cycles = await detectCycles(deps.graph, { granularity: 'file' });
    cycleCount = cycles.length;
  } catch {
    // Cycle detection may fail on empty graphs; default to 0
  }

  const data: GetSummaryResult = {
    entities,
    relations,
    languages,
    top_modules: topModules,
    average_quality_score: averageQualityScore,
    layers,
    cycle_count: cycleCount,
    last_indexed: lastIndexed,
  };

  return toMCPContent(buildResponse(data, lastIndexed));
}

async function loadLayerInfo(
  flowlensDir: string,
  graph: ServerDependencies['graph'],
): Promise<Array<{ name: string; entity_count: number }>> {
  const archPath = join(flowlensDir, 'architecture.json');
  if (!existsSync(archPath)) return [];
  try {
    const content = await readFile(archPath, 'utf-8');
    const config = JSON.parse(content) as ArchitectureConfig;
    const { resolveLayer } = await import('../../analysis/architecture-validator.js');
    const allEntities = await graph.getAllNodes();

    const layerCounts = new Map<string, number>();
    for (const l of config.layers) {
      layerCounts.set(l.name, 0);
    }
    for (const entity of allEntities) {
      const layer = resolveLayer(entity, config);
      if (layer) {
        layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
      }
    }

    return config.layers.map(l => ({
      name: l.name,
      entity_count: layerCounts.get(l.name) ?? 0,
    }));
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
