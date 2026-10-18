/**
 * Memoised analyses on a GraphView, so summary/cycles/architecture calls
 * reuse work until the graph changes.
 */

import type { RelationType } from '../contracts/relations.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import type { CycleGranularity, CycleSeverity, DetectedCycle } from '../contracts/analysis/cycles.js';
import { detectCyclesInData, SEVERITY_ORDER } from '../analysis/cycle-detector.js';
import { validateArchitectureData, buildLayerMap } from '../analysis/architecture-validator.js';
import { loadArchConfig } from '../analysis/arch-config.js';
import { isInScope } from '../analysis/module-path.js';
import type { InterfaceDiff } from '../contracts/analysis/diff.js';
import type { SnapshotData } from '../contracts/analysis/snapshots.js';
import { computeDiff } from '../analysis/diff-computer.js';
import { viewAsGraphStore, type GraphView } from './graph-view.js';

export interface ArchContext {
  config: ArchitectureConfig;
  layerMap: Map<string, string | null>;
  key: string;
}

/** Architecture context when architecture.json is present and valid, else null. */
export async function optionalArch(flowlensDir: string, view: GraphView): Promise<ArchContext | null> {
  const loaded = await loadArchConfig(flowlensDir);
  if (loaded.status !== 'ok') return null;
  const key = `layers:${JSON.stringify(loaded.config.layers)}`;
  return { config: loaded.config, layerMap: view.cached(key, () => buildLayerMap(view.nodes, loaded.config)), key };
}

export interface CycleQuery {
  granularity: Exclude<CycleGranularity, 'all'> | 'all';
  relation_types?: RelationType[];
  scope?: string;
  severity_threshold?: CycleSeverity;
  include_type_only?: boolean;
}

export function cachedCycles(view: GraphView, q: CycleQuery, arch: ArchContext | null): DetectedCycle[] {
  const rel = q.relation_types ? [...q.relation_types].sort().join(',') : '*';
  const types = q.include_type_only ? 'types' : 'runtime';
  const key = `cycles:${q.granularity}:${rel}:${types}:${arch?.key ?? 'noarch'}`;
  const all = view.cached(key, () => detectCyclesInData(view.nodes, view.edges, {
    granularity: q.granularity,
    relation_types: q.relation_types,
    include_type_only: q.include_type_only,
    architecture: arch?.config ?? null,
    layerMap: arch?.layerMap,
  }));
  return all.filter((c) =>
    (!q.severity_threshold || SEVERITY_ORDER[c.severity] >= SEVERITY_ORDER[q.severity_threshold])
    && (!q.scope || cycleInScope(c, view, q.scope)));
}

function cycleInScope(c: DetectedCycle, view: GraphView, scope: string): boolean {
  const byPath = c.granularity === 'file' || c.granularity === 'module';
  return c.entities.some((m) => isInScope(byPath ? m : view.byId.get(m)?.file ?? m, scope));
}

export function cachedViolations(view: GraphView, arch: ArchContext): ArchitectureViolation[] {
  return view.cached(`violations:${arch.key}`, () =>
    validateArchitectureData(view.nodes, view.edges, arch.config, arch.layerMap));
}

/** Interface diff vs a snapshot, memoised per (snapshot, options) for this graph load. */
export function cachedDiff(
  view: GraphView,
  snapshot: SnapshotData,
  options: { breaking_only?: boolean; scope?: string },
): Promise<InterfaceDiff> {
  const key = `diff:${snapshot.sha}:${snapshot.timestamp}:${options.breaking_only ?? false}:${options.scope ?? ''}`;
  return view.cached(key, () => computeDiff(viewAsGraphStore(view), snapshot, options));
}
