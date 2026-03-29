/**
 * Barrel module composing all relation extraction modules into a
 * single `extractRelations` entry point.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { extractImportRelations } from './import-relations.js';
import { extractCallRelations } from './call-relations.js';
import { extractInheritanceRelations } from './inheritance-relations.js';
import { extractTypeRelations } from './type-relations.js';
import { extractDecorateRelations } from './decorate-relations.js';
import { extractDataRelations } from './data-relations.js';

/**
 * Extract all relations from a parsed AST.
 *
 * @param root     - The root SgNode of the parsed file
 * @param filePath - Normalized relative file path
 * @param entities - Entities already extracted from this file
 * @param rootDir  - Project root directory (used for import resolution)
 */
export function extractRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  rootDir: string,
): Relation[] {
  const relations: Relation[] = [];

  extractImportRelations(root, filePath, rootDir, relations);
  extractCallRelations(root, filePath, entities, relations);
  extractInheritanceRelations(root, filePath, entities, relations);
  extractTypeRelations(root, filePath, entities, relations);
  extractDecorateRelations(root, filePath, entities, relations);
  extractDataRelations(root, filePath, entities, relations);

  return relations;
}
