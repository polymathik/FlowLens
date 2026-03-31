/**
 * check_architecture tool — validates the codebase graph against architecture
 * layer rules defined in architecture.json and reports violations.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDependencies } from '../server.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import { validateArchitecture, resolveLayer } from '../../analysis/architecture-validator.js';
import { buildResponse, toMCPContent, toMCPError } from '../response-builder.js';
import { getLastIndexed } from '../last-indexed.js';

export interface CheckArchitectureInput {
  scope?: string;
  max_results?: number;
}

export interface LayerInfo {
  name: string;
  entity_count: number;
  violation_count: number;
}

export interface CheckArchitectureResult {
  violations: ArchitectureViolation[];
  layers: LayerInfo[];
  summary: {
    total_violations: number;
    layers_with_violations: string[];
  };
}

const MAX_RESULTS_CAP = 250;

export async function handleCheckArchitecture(
  args: CheckArchitectureInput,
  deps: ServerDependencies,
) {
  const lastIndexed = await getLastIndexed(deps.fileIndexPath);
  const maxResults = Math.min(args.max_results ?? 50, MAX_RESULTS_CAP);

  const archConfig = await loadArchConfig(deps.flowlensDir);
  if (!archConfig) {
    return toMCPError(
      'No architecture.json found — run "flowlens infer-architecture" first',
      [],
      lastIndexed,
    );
  }

  let violations = await validateArchitecture(deps.graph, archConfig);

  // Apply scope filter
  if (args.scope) {
    violations = violations.filter(v =>
      v.location.file.startsWith(args.scope!),
    );
  }

  // Build layer info
  const allEntities = await deps.graph.getAllNodes();
  const layerEntityCounts = new Map<string, number>();
  const layerViolationCounts = new Map<string, number>();

  for (const layer of archConfig.layers) {
    layerEntityCounts.set(layer.name, 0);
    layerViolationCounts.set(layer.name, 0);
  }

  for (const entity of allEntities) {
    const layer = resolveLayer(entity, archConfig);
    if (layer) {
      layerEntityCounts.set(layer, (layerEntityCounts.get(layer) ?? 0) + 1);
    }
  }

  for (const v of violations) {
    layerViolationCounts.set(v.layer_from, (layerViolationCounts.get(v.layer_from) ?? 0) + 1);
  }

  const layers: LayerInfo[] = archConfig.layers.map(l => ({
    name: l.name,
    entity_count: layerEntityCounts.get(l.name) ?? 0,
    violation_count: layerViolationCounts.get(l.name) ?? 0,
  }));

  const layersWithViolations = layers
    .filter(l => l.violation_count > 0)
    .map(l => l.name);
  const totalViolations = violations.length;
  const truncated = violations.slice(0, maxResults);

  const data: CheckArchitectureResult = {
    violations: truncated,
    layers,
    summary: {
      total_violations: totalViolations,
      layers_with_violations: layersWithViolations,
    },
  };

  return toMCPContent(buildResponse(data, lastIndexed, {
    max_results: maxResults,
    actualCount: truncated.length,
    total_count: totalViolations,
  }));
}

async function loadArchConfig(flowlensDir: string): Promise<ArchitectureConfig | null> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return null;
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as ArchitectureConfig;
}

export function registerCheckArchitecture(server: McpServer, deps: ServerDependencies): void {
  server.registerTool(
    'check_architecture',
    {
      description:
        'Validates the codebase against architecture layer rules and reports violations.',
      inputSchema: {
        scope: z.string().optional().describe('Restrict to file path prefix'),
        max_results: z.number().optional().default(50).describe('Max results (default 50, max 250)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleCheckArchitecture(args as CheckArchitectureInput, deps),
  );
}
