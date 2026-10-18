/**
 * Rust language extractor.
 *
 * Extracts entities (structs, enums, traits/interfaces, functions, methods,
 * fields, variables, enum members) and relations (import, call, use, contain,
 * create, implement) from Rust ASTs parsed by tree-sitter.
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './rust-entities.js';
import { extractRelations } from './rust-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const rustExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.rs'],
  supportedRelationTypes: [
    'import', 'call', 'use', 'contain', 'create', 'implement',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
