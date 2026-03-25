/**
 * TypeScript / JavaScript language extractor.
 *
 * Wraps the existing `extractEntities` and `extractRelations` functions
 * as a `LanguageExtractor`, handling all JS-family languages (TS, TSX,
 * JS, JSX, MJS, CJS).
 */
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import type { RelationType } from '../../contracts/relations.js';
import { extractEntities } from '../entity-extractor.js';
import { extractRelations } from '../relation-extractor.js';

export const typescriptExtractor: LanguageExtractor = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  supportedRelationTypes: [
    'import',
    'call',
    'extend',
    'implement',
    'override',
    'mixin',
    'use',
    'contain',
    'create',
    'parameter',
    'return',
    'throw',
    'decorate',
  ] as RelationType[],

  extractEntities(root, filePath) {
    return extractEntities(root, filePath, 'typescript');
  },

  extractRelations(root, filePath, entities, rootDir) {
    return extractRelations(root, filePath, entities, rootDir);
  },
};
