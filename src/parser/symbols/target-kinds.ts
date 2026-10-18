/**
 * Which entity kinds may be the target of each relation type, in order of
 * preference. Used by both pass 1 (same-file lookups) and pass 2 (the
 * symbol table) so the two never disagree.
 */
import type { EntityKind } from '../../contracts/entities.js';
import type { RelationType } from '../../contracts/relations.js';

export const TARGET_KINDS: Record<RelationType, EntityKind[] | undefined> = {
  import: undefined,
  call: ['function', 'method', 'variable'],
  create: ['class'],
  throw: ['class'],
  extend: ['class', 'interface'],
  implement: ['interface', 'class'],
  override: ['method'],
  mixin: ['function', 'variable', 'class'],
  use: ['variable', 'field', 'enum_member'],
  contain: undefined,
  parameter: ['class', 'interface', 'type', 'enum'],
  return: ['class', 'interface', 'type', 'enum'],
  decorate: undefined,
};

export function targetKinds(type: RelationType): EntityKind[] | undefined {
  return TARGET_KINDS[type];
}

/** Pick the candidates of the most-preferred kind present; all candidates when no preference. */
export function preferByKind<T extends { kind: EntityKind }>(candidates: T[], kinds?: EntityKind[]): T[] {
  if (!kinds) return candidates;
  for (const k of kinds) {
    const hit = candidates.filter((c) => c.kind === k);
    if (hit.length > 0) return hit;
  }
  return [];
}
