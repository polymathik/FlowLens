/**
 * Bash language extractor (minimal tier).
 *
 * Extracts functions as entities and source/. imports plus calls
 * as relations from Bash ASTs parsed by tree-sitter.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addImportRelation,
  handleCallOrCreate, type RelationContext,
} from './relation-builder.js';

const LANG = 'bash';

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode): void {
    for (const c of node.children()) visit(c);
  }

  function visit(node: SgNode): void {
    if (node.kind() === 'function_definition') {
      // function_definition has a `word` child for the name
      const name = findChildText(node, 'word');
      if (name) {
        out.push(makeEntity(node, name, 'function', 'public', fp, LANG, []));
      }
    }
    walk(node);
  }

  walk(root);
  return out;
}

// ─── Relation Extraction ────────────────────────────────────────

function extractRelations(
  root: SgNode, fp: string, entities: Entity[], _rootDir: string,
): Relation[] {
  const ctx = createRelationContext(fp, entities);

  function walk(node: SgNode, cur: Entity | null): void {
    const k = node.kind();

    if (k === 'function_definition') {
      handleFuncDef(node, cur);
      return;
    }

    if (k === 'command') {
      handleCommand(node, cur);
    }

    for (const c of node.children()) walk(c, cur);
  }

  function handleFuncDef(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'word');
    const fn = name ? ctx.entityMap.get(name) : null;
    for (const c of node.children()) walk(c, fn ?? parent);
  }

  function handleCommand(node: SgNode, cur: Entity | null): void {
    const cmdNameNode = node.children().find(
      (c: SgNode) => c.kind() === 'command_name',
    );
    if (!cmdNameNode) return;
    const cmdName = findChildText(cmdNameNode, 'word');
    if (!cmdName) return;

    // source / . → import relation
    if (cmdName === 'source' || cmdName === '.') {
      addImportRelation(ctx, node);
      return;
    }

    // Function call
    if (cur) handleCallOrCreate(ctx, cur, cmdName, node);
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const bashExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.sh', '.bash'],
  supportedRelationTypes: ['import', 'call'] as RelationType[],
  extractEntities,
  extractRelations,
};
