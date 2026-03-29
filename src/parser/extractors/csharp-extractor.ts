/**
 * C# language extractor.
 *
 * Extracts entities and relations from C# ASTs parsed by tree-sitter.
 * Supports: classes, interfaces, enums, namespaces, methods, constructors,
 * fields, properties, attributes (decorators).
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

const LANG = 'csharp';

function csVis(node: SgNode): Visibility {
  for (const c of node.children()) {
    if (c.kind() === 'modifier') {
      const t = c.text().trim();
      if (t === 'public') return 'public';
      if (t === 'private') return 'private';
      if (t === 'protected') return 'protected';
      if (t === 'internal') return 'internal';
    }
  }
  return 'internal';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], _inClass: boolean): void {
    switch (node.kind()) {
      case 'namespace_declaration': handleNs(node, parents); break;
      case 'class_declaration': classLike(node, 'class', parents); break;
      case 'interface_declaration': classLike(node, 'interface', parents); break;
      case 'enum_declaration': handleEnum(node, parents); break;
      case 'method_declaration': handleMethod(node, parents); break;
      case 'constructor_declaration': handleCtor(node, parents); break;
      case 'field_declaration': handleField(node, parents); break;
      case 'property_declaration': handleProp(node, parents); break;
      default: walk(node, parents, false);
    }
  }

  function handleNs(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier') ?? findChildText(node, 'qualified_name');
    if (!name) return;
    out.push(makeEntity(node, name, 'namespace', 'public', fp, LANG, parents));
    const body = findChild(node, 'declaration_list');
    if (body) walk(body, [...parents, name], false);
  }

  function classLike(node: SgNode, kind: EntityKind, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, kind, csVis(node), fp, LANG, parents));
    extractAttrs(node, parents);
    const body = findChild(node, 'declaration_list');
    if (body) walk(body, [...parents, name], true);
  }

  function handleEnum(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'enum', csVis(node), fp, LANG, parents));
    const body = findChild(node, 'enum_member_declaration_list');
    if (!body) return;
    for (const c of body.children()) {
      if (c.kind() === 'enum_member_declaration') {
        const mn = findChildText(c, 'identifier');
        if (mn) out.push(makeEntity(c, mn, 'enum_member', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', csVis(node), fp, LANG, parents));
    extractAttrs(node, parents);
  }

  function handleCtor(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', csVis(node), fp, LANG, parents));
  }

  function handleField(node: SgNode, parents: string[]): void {
    const vis = csVis(node);
    const vd = findChild(node, 'variable_declaration');
    if (!vd) return;
    for (const c of vd.children()) {
      if (c.kind() === 'variable_declarator') {
        const name = findChildText(c, 'identifier');
        if (name) out.push(makeEntity(node, name, 'field', vis, fp, LANG, parents));
      }
    }
  }

  function handleProp(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'field', csVis(node), fp, LANG, parents));
  }

  function extractAttrs(node: SgNode, parents: string[]): void {
    for (const c of node.children()) {
      if (c.kind() === 'attribute_list') {
        for (const a of c.children()) {
          if (a.kind() === 'attribute') {
            const name = findChildText(a, 'identifier');
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
    if (k === 'using_directive') { addImportRelation(ctx, node); }
    else if (k === 'namespace_declaration') {
      const name = findChildText(node, 'identifier') ?? findChildText(node, 'qualified_name');
      const ns = name ? ctx.entityMap.get(name) : null;
      const body = findChild(node, 'declaration_list');
      if (body) for (const c of body.children()) walk(c, ns ?? cur);
      return;
    }
    else if (k === 'class_declaration') { handleClassRels(node); return; }
    else if (k === 'interface_declaration') { handleIfaceRels(node); return; }
    else if (k === 'method_declaration' || k === 'constructor_declaration') {
      handleMethodRels(node, cur); return;
    }
    else if (k === 'object_creation_expression') {
      if (cur) { const tn = findChildText(node, 'identifier'); if (tn) addRelationByName(ctx, cur, tn, 'create', node); }
    }
    else if (k === 'invocation_expression') {
      if (cur) { const n = findChildText(node, 'identifier'); if (n) { const t = ctx.entityMap.get(n); if (t && (t.kind === 'method' || t.kind === 'function')) addRelation(ctx, cur, t, 'call', node); } }
    }
    else if (k === 'throw_statement' && cur) {
      const oc = findChild(node, 'object_creation_expression');
      if (oc) { const tn = findChildText(oc, 'identifier'); if (tn) addRelationByName(ctx, cur, tn, 'throw', node); }
    }
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode): void {
    const name = findChildText(node, 'identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    const bl = findChild(node, 'base_list');
    if (bl) for (const c of bl.children()) {
      if (c.kind() === 'identifier') {
        const bn = c.text();
        const type = (bn.length > 1 && bn[0] === 'I' && bn[1] === bn[1].toUpperCase() && bn[1] !== bn[1].toLowerCase()) ? 'implement' : 'extend';
        addRelationByName(ctx, cls, bn, type as RelationType, c);
      }
    }
    attrRels(node, cls);

    const body = findChild(node, 'declaration_list');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'field_declaration') fieldContain(c, cls, name!);
      walk(c, cls);
    }
  }

  function handleIfaceRels(node: SgNode): void {
    const name = findChildText(node, 'identifier');
    const iface = name ? ctx.entityMap.get(name) : null;
    if (!iface) return;
    const body = findChild(node, 'declaration_list');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'method_declaration') {
        const mn = findChildText(c, 'identifier');
        const me = mn ? findMethodEntity(ctx, mn, iface) : null;
        if (me) addRelation(ctx, iface, me, 'contain', c);
      }
      walk(c, iface);
    }
  }

  function handleMethodRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const me = name ? findMethodEntity(ctx, name, parent) : null;
    const cur = me ?? parent;
    if (parent && me) addRelation(ctx, parent, me, 'contain', node);
    attrRels(node, cur);
    for (const c of node.children()) walk(c, cur);
  }

  function attrRels(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    for (const c of node.children()) {
      if (c.kind() === 'attribute_list') for (const a of c.children()) {
        if (a.kind() === 'attribute') {
          const an = findChildText(a, 'identifier');
          const de = an ? entities.find(e => e.kind === 'decorator' && e.name === an) : null;
          if (de) addRelation(ctx, de, cur, 'decorate', a);
        }
      }
    }
  }

  function fieldContain(node: SgNode, cls: Entity, clsName: string): void {
    const vd = findChild(node, 'variable_declaration');
    if (!vd) return;
    for (const c of vd.children()) {
      if (c.kind() === 'variable_declarator') {
        const fn = findChildText(c, 'identifier');
        const fe = fn ? entities.find(e => e.name === fn && e.kind === 'field' && e.qualified_name.includes(`${clsName}.`)) : null;
        if (fe) addRelation(ctx, cls, fe, 'contain', node);
      }
    }
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const csharpExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.cs'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'throw', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
