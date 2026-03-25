import type { Entity } from './entities.js';
import type { Relation, RelationType } from './relations.js';

export interface LanguageExtractor {
  /** The language this extractor handles */
  language: string;

  /** File extensions this extractor supports */
  extensions: string[];

  /** Which relation types this extractor can detect */
  supportedRelationTypes: RelationType[];

  /** Extract entities from an AST root node */
  extractEntities(root: any, filePath: string): Entity[];

  /** Extract relations from an AST root node and already-extracted entities */
  extractRelations(root: any, filePath: string, entities: Entity[], rootDir: string): Relation[];
}
