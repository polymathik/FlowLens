import type { Entity } from './entities.js';
import type { Relation, RelationType } from './relations.js';
import type { FileSymbols } from './symbols.js';

export interface LanguageExtractor {
  /** The language this extractor handles */
  language: string;

  /** File extensions this extractor supports */
  extensions: string[];

  /** Which relation types this extractor can detect */
  supportedRelationTypes: RelationType[];

  /** Extract entities from an AST root node */
  extractEntities(root: any, filePath: string): Entity[];

  /**
   * Extract relations from an AST root node and already-extracted entities.
   *
   * Phase 8: the result may contain *pending* relations (`to === ''`,
   * `resolution: 'unresolved'`, `target_name` set) for cross-file targets; the
   * parser moves them to `ParseResult.pending`. `symbols` is the output of
   * `extractSymbols` when the extractor provides it.
   */
  extractRelations(
    root: any,
    filePath: string,
    entities: Entity[],
    rootDir: string,
    symbols?: FileSymbols,
  ): Relation[];

  /** Phase 8 (optional): imports / exports / package scope for pass-2 resolution. */
  extractSymbols?(root: any, filePath: string, entities: Entity[], rootDir: string): FileSymbols;

  /**
   * Phase 8: whether this extractor's cognitive-complexity numbers are
   * meaningful. When false the metric is left undefined (absent), never 0.
   */
  cognitiveComplexity?: boolean;
}
