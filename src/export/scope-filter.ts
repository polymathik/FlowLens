/**
 * Shared filtering logic used by all export formats.
 *
 * Filters entities by file-path prefix (scope) and relations by both
 * relation type AND endpoint membership in the filtered entity set.
 * Relations whose endpoints fell out of scope are dropped — otherwise
 * exporters would produce dangling edges.
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';
import type { ExportOptions } from '../contracts/export.js';

export function filterForExport(
  entities: Entity[],
  relations: Relation[],
  options: Pick<ExportOptions, 'scope' | 'relation_types'>,
): { entities: Entity[]; relations: Relation[] } {
  let filteredEntities = entities;
  if (options.scope) {
    const prefix = options.scope;
    filteredEntities = entities.filter((e) => e.file.startsWith(prefix));
  }

  const allowedIds = new Set(filteredEntities.map((e) => e.id));
  const typeFilter = options.relation_types
    ? new Set<RelationType>(options.relation_types)
    : null;

  const filteredRelations = relations.filter((r) => {
    if (typeFilter && !typeFilter.has(r.type)) return false;
    return allowedIds.has(r.from) && allowedIds.has(r.to);
  });

  return { entities: filteredEntities, relations: filteredRelations };
}
