/**
 * Type-level relations (Phase 12): edges that express only types and have no
 * runtime effect, so they cannot form a runtime dependency loop.
 *
 * An edge is type-level when it is
 *   - an `import type` / `export type … from` (`meta.type_only`, Phase 8),
 *   - a type annotation (`parameter`, `return`, `implement`), or
 *   - any reference whose target is a pure type (`interface` / `type` alias),
 *     e.g. `extend` of an interface or a `use` of a type alias.
 *
 * Cycle detection ignores these by default (`include_type_only` opts in).
 */
import type { Entity, EntityKind } from '../contracts/entities.js';
import { TYPE_ANNOTATION_RELATION_TYPES, type Relation } from '../contracts/relations.js';

const ANNOTATION_TYPES = new Set<string>(TYPE_ANNOTATION_RELATION_TYPES);
const PURE_TYPE_KINDS = new Set<EntityKind>(['interface', 'type']);

export function isTypeLevelRelation(rel: Relation, targetKind?: EntityKind): boolean {
  if (rel.meta?.type_only) return true;
  if (ANNOTATION_TYPES.has(rel.type)) return true;
  return rel.type !== 'import' && targetKind !== undefined && PURE_TYPE_KINDS.has(targetKind);
}

/** Predicate over a graph's edges, resolving target kinds from its entities. */
export function typeLevelPredicate(entities: Entity[]): (rel: Relation) => boolean {
  const kinds = new Map(entities.map((e) => [e.id, e.kind]));
  return (rel) => isTypeLevelRelation(rel, kinds.get(rel.to));
}
