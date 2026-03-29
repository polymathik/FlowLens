/**
 * Shared entity-building helpers for language extractors.
 *
 * Provides a factory function to create entities with consistent structure,
 * reducing boilerplate across all extractors.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { generateEntityId } from '../../utils/id.js';
import { buildQualifiedName, nodeLocation } from '../extractor-helpers.js';

/** Create an entity with consistent structure. */
export function makeEntity(
  node: SgNode,
  name: string,
  kind: EntityKind,
  visibility: Visibility,
  filePath: string,
  language: string,
  parents: string[],
): Entity {
  const qn = buildQualifiedName(filePath, parents, name);
  const loc = nodeLocation(node);
  return {
    id: generateEntityId(filePath, qn, kind),
    kind,
    name,
    qualified_name: qn,
    file: filePath,
    location: loc,
    visibility,
    language,
    metrics: { line_count: loc.line_end - loc.line_start + 1 },
  };
}
