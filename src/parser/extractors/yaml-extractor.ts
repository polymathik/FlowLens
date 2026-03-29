/**
 * YAML structural extractor.
 *
 * Extracts top-level mapping keys as `field` entities.
 * No relations are extracted — YAML is structural only.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

const LANG = 'yaml';

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  // stream → document → block_node → block_mapping → block_mapping_pair*
  const stream = root.kind() === 'stream' ? root : null;
  if (!stream) return out;

  const doc = findChild(stream, 'document');
  if (!doc) return out;

  const blockNode = findChild(doc, 'block_node');
  if (!blockNode) return out;

  const mapping = findChild(blockNode, 'block_mapping');
  if (!mapping) return out;

  for (const c of mapping.children()) {
    if (c.kind() !== 'block_mapping_pair') continue;
    // block_mapping_pair → flow_node (key) : ...
    const keyNode = findChild(c, 'flow_node');
    if (!keyNode) continue;
    const keyText = keyNode.text().trim();
    if (keyText) {
      out.push(makeEntity(c, keyText, 'field', 'public', fp, LANG, []));
    }
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

export const yamlExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.yml', '.yaml'],
  supportedRelationTypes: [] as RelationType[],
  extractEntities,
  extractRelations,
};
