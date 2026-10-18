/**
 * Swift language extractor.
 *
 * Extracts entities (classes, structs, protocols/interfaces, enums,
 * functions, methods, fields) and relations (import, call, extend,
 * implement, use, contain, create, decorate) from Swift ASTs parsed
 * by tree-sitter.
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './swift-entities.js';
import { extractRelations } from './swift-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const swiftExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.swift'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
