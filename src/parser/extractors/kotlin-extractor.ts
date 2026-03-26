/**
 * Kotlin language extractor.
 *
 * Kotlin has unique AST patterns: class_declaration covers classes,
 * interfaces, and enum classes; function_declaration covers both functions
 * and methods; property_declaration covers fields and variables.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addRelationByName,
  addImportRelation, handleCallOrCreate, findMethodEntity, type RelationContext,
} from './relation-builder.js';

const LANG = 'kotlin';

function ktVis(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'public';
  for (const c of mods.children()) {
    if (c.kind() === 'visibility_modifier') {
      const t = c.text().trim();
      if (t === 'private') return 'private';
      if (t === 'protected') return 'protected';
      if (t === 'internal') return 'internal';
    }
  }
  return 'public';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_declaration': handleClassDecl(node, parents); break;
      case 'object_declaration': handleObject(node, parents); break;
      case 'function_declaration': handleFunc(node, parents, inClass); break;
      case 'property_declaration': handleProp(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClassDecl(node: SgNode, parents: string[]): void {
    let kind: EntityKind = 'class';
    let isAnnotation = false;
    const hasIface = findChild(node, 'interface');
    const hasEnum = findChild(node, 'enum');
    const mods = findChild(node, 'modifiers');

    if (hasIface) kind = 'interface';
    else if (hasEnum) kind = 'enum';
    if (mods) for (const c of mods.children()) {
      if (c.kind() === 'class_modifier' && c.text().trim() === 'annotation') isAnnotation = true;
    }

    const name = findChildText(node, 'type_identifier');
    if (!name) return;

    if (isAnnotation) {
      out.push(makeEntity(node, name, 'decorator', ktVis(node), fp, LANG, parents));
      return;
    }

    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);

    if (kind === 'enum') {
      const eb = findChild(node, 'enum_class_body');
      if (eb) for (const c of eb.children()) {
        if (c.kind() === 'enum_entry') {
          const en = findChildText(c, 'simple_identifier');
          if (en) out.push(makeEntity(c, en, 'enum_member', 'public', fp, LANG, [...parents, name]));
        }
      }
      return;
    }

    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleObject(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', ktVis(node), fp, LANG, parents));
    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleFunc(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);
  }

  function handleProp(node: SgNode, parents: string[], inClass: boolean): void {
    const vd = findChild(node, 'variable_declaration');
    const name = vd ? findChildText(vd, 'simple_identifier') : findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
  }

  function extractAnnotations(node: SgNode, parents: string[]): void {
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() !== 'annotation') continue;
      const ci = findChild(c, 'constructor_invocation');
      const ut = ci ? findChild(ci, 'user_type') : findChild(c, 'user_type');
      const tn = ut ? findChildText(ut, 'type_identifier') : null;
      if (tn) out.push(makeEntity(c, tn, 'decorator', 'public', fp, LANG, parents));
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
    if (k === 'import_header') { addImportRelation(ctx, node); }
    else if (k === 'class_declaration') { handleClassRels(node); return; }
    else if (k === 'object_declaration') {
      const name = findChildText(node, 'type_identifier');
      const obj = name ? ctx.entityMap.get(name) : null;
      const body = findChild(node, 'class_body');
      if (body) for (const c of body.children()) walk(c, obj ?? cur);
      return;
    }
    else if (k === 'function_declaration') {
      const name = findChildText(node, 'simple_identifier');
      const fn = name ? findMethodEntity(ctx, name, cur) : null;
      if (cur && fn) addRelation(ctx, cur, fn, 'contain', node);
      annotationRels(node, fn ?? cur);
      for (const c of node.children()) walk(c, fn ?? cur);
      return;
    }
    else if (k === 'call_expression') {
      const cn = findChildText(node, 'simple_identifier');
      if (cn) handleCallOrCreate(ctx, cur, cn, node);
    }
    else if (k === 'property_declaration' && cur) {
      const vd = findChild(node, 'variable_declaration');
      const name = vd ? findChildText(vd, 'simple_identifier') : findChildText(node, 'simple_identifier');
      const pe = name ? entities.find(e => e.name === name && (e.kind === 'field' || e.kind === 'variable')) : null;
      if (pe) addRelation(ctx, cur, pe, 'contain', node);
    }
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    for (const c of node.children()) {
      if (c.kind() === 'delegation_specifier') {
        const ci = findChild(c, 'constructor_invocation');
        if (ci) {
          const ut = findChild(ci, 'user_type');
          const bn = ut ? findChildText(ut, 'type_identifier') : null;
          if (bn) addRelationByName(ctx, cls, bn, 'extend', c);
        } else {
          const ut = findChild(c, 'user_type');
          const in_ = ut ? findChildText(ut, 'type_identifier') : null;
          if (in_) addRelationByName(ctx, cls, in_, 'implement', c);
        }
      }
    }
    annotationRels(node, cls);
    const body = findChild(node, 'class_body');
    if (body) for (const c of body.children()) walk(c, cls);
  }

  function annotationRels(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() !== 'annotation') continue;
      const ci = findChild(c, 'constructor_invocation');
      const ut = ci ? findChild(ci, 'user_type') : findChild(c, 'user_type');
      const an = ut ? findChildText(ut, 'type_identifier') : null;
      if (an) {
        const de = entities.find(e => e.kind === 'decorator' && e.name === an);
        if (de) addRelation(ctx, de, cur, 'decorate', c);
      }
    }
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const kotlinExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.kt'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement', 'override', 'mixin',
    'use', 'contain', 'create', 'parameter', 'return', 'throw', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
