/**
 * Edge aggregation: one edge per (from, type, to).
 *
 * Repeated occurrences (two calls to the same function, a value and a type
 * import of the same module) collapse into the first occurrence; `weight`
 * becomes the occurrence count, `confidence` the maximum, and `type_only`
 * survives only when every occurrence was type-only.
 */
import type { Relation } from '../contracts/relations.js';

export function edgeKey(r: Pick<Relation, 'from' | 'type' | 'to' | 'target_name'>): string {
  const to = r.to || `?${r.target_name ?? ''}`;
  return `${r.from}\u0000${r.type}\u0000${to}`;
}

export function aggregateRelations(relations: Relation[]): Relation[] {
  const byKey = new Map<string, Relation>();
  for (const r of relations) {
    const key = edgeKey(r);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...r, weight: r.weight || 1, ...(r.meta ? { meta: { ...r.meta } } : {}) });
      continue;
    }
    prev.weight += r.weight || 1;
    prev.confidence = Math.max(prev.confidence, r.confidence);
    if (prev.meta?.type_only && !r.meta?.type_only) {
      delete prev.meta.type_only;
      if (Object.keys(prev.meta).length === 0) delete prev.meta;
    }
    if (prev.resolution === 'resolved' && r.resolution !== 'resolved') {
      // a direct occurrence makes the edge direct
      delete prev.resolution;
    }
  }
  return [...byKey.values()];
}
