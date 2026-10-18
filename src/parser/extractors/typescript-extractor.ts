/**
 * TypeScript / JavaScript language extractor.
 *
 * One factory builds the extractor for each JS-family language key so the
 * entities carry the real language (`javascript` files are not labelled
 * `typescript`).
 */
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import type { RelationType } from '../../contracts/relations.js';
import { extractEntities } from '../entity-extractor.js';
import { extractRelations } from '../relation-extractor.js';
import { extractTsSymbols } from '../symbols/ts-symbols.js';

const RELATION_TYPES: RelationType[] = [
  'import', 'call', 'extend', 'implement', 'override', 'mixin', 'use',
  'contain', 'create', 'parameter', 'return', 'throw', 'decorate',
];

export function createTypescriptExtractor(language: string): LanguageExtractor {
  return {
    language,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    supportedRelationTypes: RELATION_TYPES,
    cognitiveComplexity: true,
    extractEntities(root, filePath) {
      return extractEntities(root, filePath, language);
    },
    extractSymbols(root, filePath, _entities, rootDir) {
      return extractTsSymbols(root, filePath, rootDir, language);
    },
    extractRelations(root, filePath, entities, rootDir, symbols) {
      return extractRelations(root, filePath, entities, rootDir, symbols);
    },
  };
}

export const typescriptExtractor: LanguageExtractor = createTypescriptExtractor('typescript');
