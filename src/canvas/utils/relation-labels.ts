/** Human wording for relation types on edge labels and portals ("imports 12 · calls 3"). */
import type { RelationType } from '../../contracts/relations.js';
import type { TypeCounts } from '../../contracts/canvas/index.js';

export const RELATION_WORDS: Record<RelationType, string> = {
  import: 'imports',
  call: 'calls',
  extend: 'extends',
  implement: 'implements',
  override: 'overrides',
  mixin: 'mixins',
  use: 'uses',
  contain: 'contains',
  create: 'creates',
  parameter: 'param types',
  return: 'return types',
  throw: 'throws',
  decorate: 'decorates',
};

/** Types sorted by count (desc), then name. */
export function rankTypeCounts(counts: TypeCounts): Array<[RelationType, number]> {
  return (Object.entries(counts) as Array<[RelationType, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "imports 12 · calls 3". Restrict to `only` to label just the visible relation types. */
export function describeCounts(counts: TypeCounts, only?: ReadonlySet<string>): string {
  return rankTypeCounts(counts)
    .filter(([t]) => !only || only.has(t))
    .map(([t, n]) => `${RELATION_WORDS[t] ?? t} ${n}`)
    .join(' · ');
}

/** Sum of counts, restricted to `only` when given. */
export function totalOf(counts: TypeCounts, only?: ReadonlySet<string>): number {
  let sum = 0;
  for (const [t, n] of Object.entries(counts)) if (!only || only.has(t)) sum += n ?? 0;
  return sum;
}
