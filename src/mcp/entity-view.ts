/**
 * Progressive disclosure: map stored entities to the contract's EntityView.
 * `summary` = compact ref (id, kind, name, qn, file, line + key metrics);
 * `full` = the complete Entity plus `line`.
 */

import type { Entity, EntityMetrics } from '../contracts/entities.js';
import type { Detail, EntityView } from '../contracts/mcp/tools.js';

export const DEFAULT_DETAIL: Detail = 'summary';

const KEY_METRICS = ['cognitive_complexity', 'quality_score', 'hotspot_score'] as const;

export function keyMetrics(m: EntityMetrics | undefined): Partial<EntityMetrics> | undefined {
  if (!m) return undefined;
  const out: Partial<EntityMetrics> = {};
  for (const k of KEY_METRICS) {
    if (m[k] !== undefined) out[k] = round(m[k]!);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function toEntityView(e: Entity, detail: Detail, opts: { metrics?: boolean } = {}): EntityView {
  const includeMetrics = opts.metrics ?? true;
  if (detail === 'full') {
    const { metrics, ...rest } = e;
    return { ...rest, line: e.location?.line_start ?? 0, ...(includeMetrics && metrics ? { metrics } : {}) };
  }
  const view: EntityView = {
    id: e.id,
    kind: e.kind,
    name: e.name,
    qualified_name: e.qualified_name,
    file: e.file,
    line: e.location?.line_start ?? 0,
  };
  const km = includeMetrics ? keyMetrics(e.metrics) : undefined;
  if (km) view.metrics = km;
  return view;
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
