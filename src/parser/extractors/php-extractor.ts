/**
 * PHP language extractor.
 *
 * Extracts entities and relations from PHP ASTs parsed by tree-sitter.
 * Supports: classes, interfaces, enums, functions, methods, fields,
 * PHP 8 attributes (decorators).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addRelationByName,
  addImportRelation, findMethodEntity, type RelationContext,
} from './relation-builder.js';

const LANG = 'php';

function phpVis(node: SgNode): Visibility {
  for (const c of node.children()) {
    if (c.kind() === 'visibility_modifier') {
      const t = c.text().trim();
      if (t === 'public') return 'public';
      if (t === 'private') return 'private';
      if (t === 'protected') return 'protected';
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

  function visit(node: SgNode, parents: string[], _inClass: boolean): void {
    switch (node.kind()) {
      case 'class_declaration': handleClass(node, parents); break;
      case 'interface_declaration': handleIface(node, parents); break;
      case 'enum_declaration': handleEnum(node, parents); break;
      case 'function_definition': handleFunc(node, parents); break;
      case 'method_declaration': handleMethod(node, parents); break;
      case 'property_declaration': handleProp(node, parents); break;
      default: walk(node, parents, false);
    }
  }

  function handleClass(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'name');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    extractAttrs(node, parents);
    const body = findChild(node, 'declaration_list');
    if (body) walk(body, [...parents, name], true);
  }

  function handleIface(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'name');
    if (!name) return;
    out.push(makeEntity(node, name, 'interface', 'public', fp, LANG, parents));
    const body = findChild(node, 'declaration_list');
    if (body) walk(body, [...parents, name], true);
  }

  function handleEnum(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'name');
    if (!name) return;
    out.push(makeEntity(node, name, 'enum', 'public', fp, LANG, parents));
    const body = findChild(node, 'enum_declaration_list');
    if (!body) return;
    for (const c of body.children()) {
      if (c.kind() === 'enum_case') {
        const cn = findChildText(c, 'name');
        if (cn) out.push(makeEntity(c, cn, 'enum_member', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleFunc(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'name');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', 'public', fp, LANG, parents));
  }

  function handleMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'name');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', phpVis(node), fp, LANG, parents));
    extractAttrs(node, parents);
  }

  function handleProp(node: SgNode, parents: string[]): void {
    const vis = phpVis(node);
    for (const c of node.children()) {
      if (c.kind() === 'property_element') {
        const vn = findChildText(c, 'variable_name');
        if (!vn) continue;
        const name = vn.startsWith('$') ? vn.slice(1) : vn;
        out.push(makeEntity(node, name, 'field', vis, fp, LANG, parents));
      }
    }
  }

  function extractAttrs(node: SgNode, parents: string[]): void {
    for (const c of node.children()) {
      if (c.kind() === 'attribute_list') for (const g of c.children()) {
        if (g.kind() === 'attribute_group') for (const a of g.children()) {
          if (a.kind() === 'attribute') {
            const name = findChildText(a, 'name');
            if (name) out.push(makeEntity(a, name, 'decorator', 'public', fp, LANG, parents));
          }
        }
      }
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
    if (k === 'namespace_use_declaration') { addImportRelation(ctx, node); }
    else if (k === 'class_declaration') { handleClassRels(node); return; }
    else if (k === 'interface_declaration') { handleIfaceRels(node); return; }
    else if (k === 'method_declaration') { handleMethodRels(node, cur); return; }
    else if (k === 'function_definition') {
      const name = findChildText(node, 'name');
      const fn = name ? ctx.entityMap.get(name) : null;
      for (const c of node.children()) walk(c, fn ?? cur);
      return;
    }
    else if (k === 'object_creation_expression') {
      if (cur) { const tn = findChildText(node, 'name'); if (tn) addRelationByName(ctx, cur, tn, 'create', node); }
    }
    else if (k === 'function_call_expression') {
      if (cur) { const n = findChildText(node, 'name'); if (n) { const t = ctx.entityMap.get(n); if (t && (t.kind === 'function' || t.kind === 'method')) addRelation(ctx, cur, t, 'call', node); } }
    }
    else if (k === 'member_call_expression') {
      if (cur) { const n = findChildText(node, 'name'); if (n) { const t = ctx.entityMap.get(n); if (t && t.kind === 'method') addRelation(ctx, cur, t, 'call', node); } }
    }
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode): void {
    const name = findChildText(node, 'name');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    const bc = findChild(node, 'base_clause');
    if (bc) { const bn = findChildText(bc, 'name'); if (bn) addRelationByName(ctx, cls, bn, 'extend', bc); }

    const ic = findChild(node, 'class_interface_clause');
    if (ic) for (const c of ic.children()) {
      if (c.kind() === 'name') addRelationByName(ctx, cls, c.text(), 'implement', c);
    }

    attrRels(node, cls);

    const body = findChild(node, 'declaration_list');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'property_declaration') propContain(c, cls, name!);
      walk(c, cls);
    }
  }

  function handleIfaceRels(node: SgNode): void {
    const name = findChildText(node, 'name');
    const iface = name ? ctx.entityMap.get(name) : null;
    if (!iface) return;
    const body = findChild(node, 'declaration_list');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'method_declaration') {
        const mn = findChildText(c, 'name');
        const me = mn ? findMethodEntity(ctx, mn, iface) : null;
        if (me) addRelation(ctx, iface, me, 'contain', c);
      }
      walk(c, iface);
    }
  }

  function handleMethodRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'name');
    const me = name ? findMethodEntity(ctx, name, parent) : null;
    const cur = me ?? parent;
    if (parent && me) addRelation(ctx, parent, me, 'contain', node);
    attrRels(node, cur);
    for (const c of node.children()) walk(c, cur);
  }

  function attrRels(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    for (const c of node.children()) {
      if (c.kind() === 'attribute_list') for (const g of c.children()) {
        if (g.kind() === 'attribute_group') for (const a of g.children()) {
          if (a.kind() === 'attribute') {
            const an = findChildText(a, 'name');
            const de = an ? entities.find(e => e.kind === 'decorator' && e.name === an) : null;
            if (de) addRelation(ctx, de, cur, 'decorate', a);
          }
        }
      }
    }
  }

  function propContain(node: SgNode, cls: Entity, clsName: string): void {
    for (const c of node.children()) {
      if (c.kind() === 'property_element') {
        const vn = findChildText(c, 'variable_name');
        if (!vn) continue;
        const name = vn.startsWith('$') ? vn.slice(1) : vn;
        const fe = entities.find(e => e.name === name && e.kind === 'field' && e.qualified_name.includes(`${clsName}.`));
        if (fe) addRelation(ctx, cls, fe, 'contain', node);
      }
    }
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const phpExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.php'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
