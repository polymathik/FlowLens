/**
 * get_layer_map tool — returns the architecture layer map with entity
 * counts and violation counts per layer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDependencies } from '../server.js';
import type { ArchitectureConfig, ArchitectureLayer } from '../../contracts/architecture.js';
import { resolveLayer, validateArchitecture } from '../../analysis/architecture-validator.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface LayerDetail {
  name: string;
  entity_count: number;
  violation_count: number;
  may_only_access: string[];
  must_not_access: string[];
}

export interface GetLayerMapResult {
  layers: LayerDetail[];
  unassigned_count: number;
  summary: {
    total_layers: number;
    total_entities_assigned: number;
    total_violations: number;
  };
}

export async function handleGetLayerMap(
  _args: Record<string, never>,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);

  const archConfig = await loadArchConfig(deps.flowlensDir);
  if (!archConfig) {
    return toMCPError(
      'No architecture.json found — run "flowlens infer-architecture" first',
      [],
      lastIndexed,
    );
  }

  const allEntities = await deps.graph.getAllNodes();

  // Count entities per layer
  const layerEntityCounts = new Map<string, number>();
  let unassignedCount = 0;

  for (const layer of archConfig.layers) {
    layerEntityCounts.set(layer.name, 0);
  }

  for (const entity of allEntities) {
    const layer = resolveLayer(entity, archConfig);
    if (layer) {
      layerEntityCounts.set(layer, (layerEntityCounts.get(layer) ?? 0) + 1);
    } else {
      unassignedCount++;
    }
  }

  // Count violations per layer
  const violations = await validateArchitecture(deps.graph, archConfig);
  const layerViolationCounts = new Map<string, number>();

  for (const layer of archConfig.layers) {
    layerViolationCounts.set(layer.name, 0);
  }

  for (const v of violations) {
    layerViolationCounts.set(
      v.layer_from,
      (layerViolationCounts.get(v.layer_from) ?? 0) + 1,
    );
  }

  // Build layer details
  const layers: LayerDetail[] = archConfig.layers.map((l: ArchitectureLayer) => ({
    name: l.name,
    entity_count: layerEntityCounts.get(l.name) ?? 0,
    violation_count: layerViolationCounts.get(l.name) ?? 0,
    may_only_access: l.may_only_access ?? [],
    must_not_access: l.must_not_access ?? [],
  }));

  const totalAssigned = layers.reduce((sum, l) => sum + l.entity_count, 0);

  const data: GetLayerMapResult = {
    layers,
    unassigned_count: unassignedCount,
    summary: {
      total_layers: layers.length,
      total_entities_assigned: totalAssigned,
      total_violations: violations.length,
    },
  };

  return toMCPContent(buildResponse(data, lastIndexed));
}

async function loadArchConfig(flowlensDir: string): Promise<ArchitectureConfig | null> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as ArchitectureConfig;
}

export function registerGetLayerMap(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'get_layer_map',
    {
      description:
        'Returns the architecture layer map with entity counts and violation counts per layer.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => handleGetLayerMap({} as Record<string, never>, deps),
  );
}
