/**
 * Call-site bookkeeping for aggregated relations (Parser truth 2, item 3).
 *
 * `aggregateRelations` collapses repeated occurrences of (from, type, to) into
 * one edge; for `call` / `create` / `use` / `throw` edges the individual
 * positions survive in `meta.sites` (sorted, capped at MAX_RELATION_SITES,
 * `meta.sites_total` = number of occurrences). A one-occurrence edge carries
 * no `sites`: its only site is `location`.
 */
import { MAX_RELATION_SITES, SITED_RELATION_TYPES, type Relation, type RelationSite } from '../contracts/relations.js';

const SITED = new Set<string>(SITED_RELATION_TYPES);

export function isSitedType(type: string): boolean {
  return SITED.has(type);
}

/** All known occurrences of an edge, in source order (never empty). */
export function relationSites(r: Pick<Relation, 'location' | 'meta'>): RelationSite[] {
  return r.meta?.sites ?? [{ line: r.location.line, column: r.location.column }];
}

function bySite(a: RelationSite, b: RelationSite): number {
  return a.line - b.line || a.column - b.column;
}

/** Merge the occurrences of `next` into `prev` (mutates `prev.meta`). `prev.weight` must already include `next`. */
export function mergeSites(prev: Relation, next: Relation): void {
  if (!isSitedType(prev.type)) return;
  const merged = [...relationSites(prev), ...relationSites(next)].sort(bySite);
  const meta = prev.meta ?? (prev.meta = {});
  meta.sites = merged.slice(0, MAX_RELATION_SITES);
  meta.sites_total = prev.weight;
}
