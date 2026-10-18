/**
 * Ruby language extractor.
 *
 * Extracts entities (classes, modules/namespaces, methods, variables,
 * fields) and relations (import/require, call, extend, mixin, use,
 * contain, create) from Ruby ASTs parsed by tree-sitter.
 */
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { LANG, extractEntities } from './ruby-entities.js';
import { extractRelations } from './ruby-relations.js';

// ─── Export ─────────────────────────────────────────────────────

export const rubyExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.rb', '.rake', '.gemspec'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'mixin',
    'use', 'contain', 'create',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
