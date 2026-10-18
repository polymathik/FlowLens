/**
 * Kotlin language extractor.
 *
 * Kotlin has unique AST patterns: class_declaration covers classes,
 * interfaces, and enum classes; function_declaration covers both functions
 * and methods; property_declaration covers fields and variables.
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './kotlin-entities.js';
import { extractRelations } from './kotlin-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const kotlinExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.kt'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement', 'override',
    'use', 'contain', 'create', 'parameter', 'return', 'throw', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
