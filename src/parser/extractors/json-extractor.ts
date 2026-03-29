/**
 * JSON structural extractor.
 *
 * Extracts top-level object keys as `field` entities.
 * No relations are extracted — JSON is structural only.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

const LANG = 'json';

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  // document → object → pair*
  const doc = root.kind() === 'document' ? root : null;
  if (!doc) return out;

  const obj = findChild(doc, 'object');
  if (!obj) return out;

  for (const c of obj.children()) {
    if (c.kind() !== 'pair') continue;
    // pair → string (key) : value
    const keyNode = findChild(c, 'string');
    if (!keyNode) continue;
    const keyText = findChildText(keyNode, 'string_content');
    if (!keyText) continue;
    out.push(makeEntity(c, keyText, 'field', 'public', fp, LANG, []));
  }

  return out;
}

// ─── Relation Extraction (no-op) ────────────────────────────────

function extractRelations(
  _root: SgNode, _fp: string, _entities: Entity[], _rootDir: string,
): Relation[] {
  return [];
}

// ─── Export ─────────────────────────────────────────────────────

export const jsonExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.json'],
  supportedRelationTypes: [] as RelationType[],
  extractEntities,
  extractRelations,
};
