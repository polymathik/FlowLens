/**
 * Shared plumbing for tool handlers: the cached graph view, entity
 * resolution with structured errors, architecture config, and canvas links.
 */

import type { Entity } from '../contracts/entities.js';
import { buildCanvasUrl, type CanvasOverlay } from '../contracts/canvas-links.js';
import type { ServerDependencies } from './server.js';
import { getGraphView, type GraphView } from './graph-view.js';
import { isResolveError, resolveInView } from './entity-resolver.js';
import { toMCPError } from './response-builder.js';
import { loadArchConfig, describeArchConfigProblem } from '../analysis/arch-config.js';
import { optionalArch, type ArchContext } from './analysis-cache.js';

export function openView(deps: ServerDependencies): Promise<GraphView> {
  return getGraphView(deps);
}

export type Resolved = { entity: Entity; error?: undefined } | { entity?: undefined; error: ReturnType<typeof toMCPError> };

export function resolveOrError(view: GraphView, identifier: string): Resolved {
  const r = resolveInView(view, identifier);
  if (isResolveError(r)) {
    return { error: toMCPError({ error: r.error, code: r.code, suggestions: r.suggestions, candidates: r.candidates }, view.lastIndexed) };
  }
  return { entity: r.entity };
}

export type ArchResult =
  | (ArchContext & { error?: undefined })
  | { config?: undefined; layerMap?: undefined; key?: undefined; error: ReturnType<typeof toMCPError> };

/** Architecture context, or a structured `no_architecture` error when missing/invalid. */
export async function archOrError(deps: ServerDependencies, view: GraphView): Promise<ArchResult> {
  const arch = await optionalArch(deps.flowlensDir, view);
  if (arch) return arch;
  const loaded = await loadArchConfig(deps.flowlensDir);
  return {
    error: toMCPError({
      error: describeArchConfigProblem(loaded),
      code: 'no_architecture',
      suggestions: ['Run "flowlens init" to infer layers, or write .flowlens/architecture.json'],
    }, view.lastIndexed),
  };
}

export function entityCanvasUrl(entity: Entity, overlay?: CanvasOverlay): string {
  return buildCanvasUrl({
    kind: entity.kind === 'file' ? 'file' : entity.kind === 'module' ? 'module' : 'entity',
    identifier: entity.kind === 'file' || entity.kind === 'module' ? entity.file : entity.qualified_name,
    overlay,
  });
}
