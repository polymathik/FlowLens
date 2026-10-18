/**
 * GraphIndex — maps any graph reference (entity id, file path, directory,
 * hierarchy node id) to its chain of hierarchy nodes, deepest first and
 * root excluded:
 *
 *   symbol id  → [symbol, class?, file, folder, …, package?, folder]
 *   file path  → [file, folder, …]
 *
 * Used by the overlays to aggregate cycles, violations and diffs onto
 * whichever level is currently visible.
 */
import type { Entity } from '../../contracts/entities.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { chainOf, resolveRef } from '../../analysis/hierarchy/index.js';

export interface GraphIndex {
  entityById: Map<string, Entity>;
  hierarchy: Hierarchy;
  /** Deepest-first node chain for a reference, or [] when unknown. */
  chainFor(ref: string): string[];
  /** Deepest node of the chain that is currently visible, or null. */
  resolveVisible(ref: string, visibleIds: ReadonlySet<string>): string | null;
}

export function buildGraphIndex(entities: Entity[], hierarchy: Hierarchy): GraphIndex {
  const entityById = new Map<string, Entity>();
  for (const e of entities) entityById.set(e.id, e);
  const cache = new Map<string, string[]>();

  return {
    entityById,
    hierarchy,
    chainFor(ref) {
      let chain = cache.get(ref);
      if (!chain) {
        const node = resolveRef(hierarchy, ref);
        chain = node ? chainOf(hierarchy, node) : [];
        cache.set(ref, chain);
      }
      return chain;
    },
    resolveVisible(ref, visibleIds) {
      for (const id of this.chainFor(ref)) if (visibleIds.has(id)) return id;
      return null;
    },
  };
}
