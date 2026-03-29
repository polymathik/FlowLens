/**
 * C language extractor.
 *
 * Extracts entities (functions, variables, structs/classes, fields)
 * and relations (import, call, use, contain) from C ASTs parsed
 * by tree-sitter.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addImportRelation,
  handleCallOrCreate, type RelationContext,
} from './relation-builder.js';

const LANG = 'c';

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inStruct: boolean): void {
    for (const c of node.children()) visit(c, parents, inStruct);
  }

  function visit(node: SgNode, parents: string[], inStruct: boolean): void {
    switch (node.kind()) {
      case 'function_definition': handleFunction(node, parents); break;
      case 'struct_specifier': handleStruct(node, parents); break;
      case 'declaration': handleDeclaration(node, parents, inStruct); break;
      case 'preproc_include': break; // entity-less, handled in relations
      default: walk(node, parents, inStruct);
    }
  }

  function handleFunction(node: SgNode, parents: string[]): void {
    const decl = findChild(node, 'function_declarator');
    if (!decl) return;
    const name = findChildText(decl, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', 'public', fp, LANG, parents));
    // Walk body for local variable declarations
    const body = findChild(node, 'compound_statement');
    if (body) walk(body, parents, false);
  }

  function handleStruct(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (!fdl) return;
    for (const c of fdl.children()) {
      if (c.kind() !== 'field_declaration') continue;
      const fname = findChildText(c, 'field_identifier');
      if (fname) {
        out.push(makeEntity(c, fname, 'field', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleDeclaration(node: SgNode, parents: string[], inStruct: boolean): void {
    // Check for struct specifier inside declaration
    const structSpec = findChild(node, 'struct_specifier');
    if (structSpec) {
      handleStruct(structSpec, parents);
      return;
    }
    // Variable declaration
    const initDecl = findChild(node, 'init_declarator');
    if (initDecl) {
      const name = findChildText(initDecl, 'identifier');
      if (name) {
        const kind: EntityKind = inStruct ? 'field' : 'variable';
        out.push(makeEntity(node, name, kind, 'public', fp, LANG, parents));
      }
      return;
    }
    // Plain identifier declaration (e.g. `int x;`)
    const id = findChild(node, 'identifier');
    if (id) {
      const kind: EntityKind = inStruct ? 'field' : 'variable';
      out.push(makeEntity(node, id.text(), kind, 'public', fp, LANG, parents));
    }
  }

  walk(root, [], false);
  return out;
}

// ─── Relation Extraction ────────────────────────────────────────

function extractRelations(
  root: SgNode, fp: string, entities: Entity[], _rootDir: string,
): Relation[] {
  const ctx = createRelationContext(fp, entities);

  function walk(node: SgNode, cur: Entity | null): void {
    const k = node.kind();

    if (k === 'preproc_include') {
      addImportRelation(ctx, node);
    } else if (k === 'function_definition') {
      handleFuncRels(node, cur);
      return;
    } else if (k === 'struct_specifier') {
      handleStructRels(node);
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'field_expression') {
      handleFieldUse(node, cur);
    }

    for (const c of node.children()) walk(c, cur);
  }

  function handleFuncRels(node: SgNode, _parent: Entity | null): void {
    const decl = findChild(node, 'function_declarator');
    const name = decl ? findChildText(decl, 'identifier') : null;
    const fn = name ? ctx.entityMap.get(name) : null;
    for (const c of node.children()) walk(c, fn ?? _parent);
  }

  function handleStructRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const ent = name ? ctx.entityMap.get(name) : null;
    if (!ent) return;
    const fdl = findChild(node, 'field_declaration_list');
    if (!fdl) return;
    for (const c of fdl.children()) {
      if (c.kind() !== 'field_declaration') continue;
      const fn = findChildText(c, 'field_identifier');
      const fe = fn ? entities.find(
        e => e.name === fn && e.kind === 'field'
          && e.qualified_name.includes(`${name}.`),
      ) : null;
      if (fe) addRelation(ctx, ent, fe, 'contain', c);
    }
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const id = findChild(node, 'identifier');
    if (id) handleCallOrCreate(ctx, cur, id.text(), node);
  }

  function handleFieldUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const parent = node.parent();
    if (parent && parent.kind() === 'call_expression') return;

    const fieldId = findChildText(node, 'field_identifier');
    if (fieldId) {
      const target = entities.find(e => e.name === fieldId && e.kind === 'field');
      if (target) addRelation(ctx, cur, target, 'use', node);
    }
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const cExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.c', '.h'],
  supportedRelationTypes: [
    'import', 'call', 'use', 'contain',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
