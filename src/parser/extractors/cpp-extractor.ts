/**
 * C++ language extractor.
 *
 * Extends C patterns with classes, namespaces, inheritance, and new-expressions.
 * Extracts entities (classes, namespaces, functions, methods, fields, variables)
 * and relations (import, call, extend, use, contain, create).
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './cpp-entities.js';
import { extractRelations } from './cpp-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const cppExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'use', 'contain', 'create',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
