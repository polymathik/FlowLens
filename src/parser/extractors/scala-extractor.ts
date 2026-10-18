/**
 * Scala language extractor.
 *
 * Extracts entities (classes, traits/interfaces, objects, functions,
 * methods, fields, variables) and relations (import, call, extend,
 * implement, use, contain, create, decorate) from Scala ASTs parsed
 * by tree-sitter.
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './scala-entities.js';
import { extractRelations } from './scala-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const scalaExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.scala', '.sc'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
