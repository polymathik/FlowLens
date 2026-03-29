/**
 * Java language extractor.
 *
 * Extracts entities and relations from Java ASTs parsed by tree-sitter.
 * Supports: classes, interfaces, enums, methods, constructors, fields,
 * annotations, and all 13 relation types.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText, nodeLocation } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addRelationByName,
  addImportRelation, findMethodEntity, type RelationContext,
} from './relation-builder.js';

const LANG = 'java';

function javaVis(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'internal';
  for (const c of mods.children()) {
    if (c.kind() === 'public') return 'public';
    if (c.kind() === 'private') return 'private';
    if (c.kind() === 'protected') return 'protected';
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
      case 'class_declaration': classLike(node, 'class', parents); break;
      case 'interface_declaration': classLike(node, 'interface', parents); break;
      case 'enum_declaration': handleEnum(node, parents); break;
      case 'method_declaration':
      case 'constructor_declaration':
        handleMethod(node, parents); break;
      case 'field_declaration': handleField(node, parents); break;
      default: walk(node, parents, false);
    }
  }

  function classLike(node: SgNode, kind: EntityKind, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, kind, javaVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);
    const bodyKind = kind === 'interface' ? 'interface_body' : 'class_body';
    const body = findChild(node, bodyKind);
    if (body) walk(body, [...parents, name], true);
  }

  function handleEnum(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'enum', javaVis(node), fp, LANG, parents));
    const body = findChild(node, 'enum_body');
    if (!body) return;
    for (const c of body.children()) {
      if (c.kind() === 'enum_constant') {
        const mn = findChildText(c, 'identifier');
        if (mn) out.push(makeEntity(c, mn, 'enum_member', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', javaVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);
  }

  function handleField(node: SgNode, parents: string[]): void {
    const vis = javaVis(node);
    for (const c of node.children()) {
      if (c.kind() === 'variable_declarator') {
        const name = findChildText(c, 'identifier');
        if (name) out.push(makeEntity(node, name, 'field', vis, fp, LANG, parents));
      }
    }
  }

  function extractAnnotations(node: SgNode, parents: string[]): void {
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() === 'marker_annotation' || c.kind() === 'annotation') {
        const name = findChildText(c, 'identifier');
        if (name) out.push(makeEntity(c, name, 'decorator', 'public', fp, LANG, parents));
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
    if (k === 'import_declaration') { addImportRelation(ctx, node); }
    else if (k === 'class_declaration') { handleClassRels(node, cur); return; }
    else if (k === 'interface_declaration') { handleIfaceRels(node); return; }
    else if (k === 'method_declaration' || k === 'constructor_declaration') {
      handleMethodRels(node, cur); return;
    }
    else if (k === 'object_creation_expression') { handleCreate(node, cur); }
    else if (k === 'method_invocation') { handleCall(node, cur); }
    else if (k === 'field_access' && cur) {
      const fname = findChildText(node, 'identifier');
      if (fname) {
        const target = entities.find(e => e.name === fname && (e.kind === 'field' || e.kind === 'variable'));
        if (target) addRelation(ctx, cur, target, 'use', node);
      }
    }
    else if (k === 'identifier' && cur) {
      // Only create use relation if parent is NOT a method_invocation (that would be a call)
      const parentKind = node.parent()?.kind();
      if (parentKind !== 'method_invocation' && parentKind !== 'method_declaration'
        && parentKind !== 'variable_declarator' && parentKind !== 'field_declaration'
        && parentKind !== 'class_declaration' && parentKind !== 'type_identifier') {
        const target = entities.find(e => e.name === node.text() && (e.kind === 'field' || e.kind === 'variable'));
        if (target) addRelation(ctx, cur, target, 'use', node);
      }
    }
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    const sc = findChild(node, 'superclass');
    if (sc) { const bn = findChildText(sc, 'type_identifier'); if (bn) addRelationByName(ctx, cls, bn, 'extend', sc); }

    const si = findChild(node, 'super_interfaces');
    if (si) { const tl = findChild(si, 'type_list'); if (tl) for (const c of tl.children()) { if (c.kind() === 'type_identifier') addRelationByName(ctx, cls, c.text(), 'implement', c); } }

    annotationRels(node, cls);

    // Resolve parent class entity for override detection
    const parentName = sc ? findChildText(sc, 'type_identifier') : null;
    const parentEntity = parentName ? ctx.entityMap.get(parentName) : null;

    const body = findChild(node, 'class_body');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'method_declaration' || c.kind() === 'constructor_declaration') {
        const mn = findChildText(c, 'identifier');
        const me = mn ? findMethodEntity(ctx, mn, cls) : null;
        if (me) addRelation(ctx, cls, me, 'contain', c);
        // Override: child method with same name as parent method
        if (me && parentEntity) {
          const parentMethod = findMethodEntity(ctx, mn!, parentEntity);
          if (parentMethod) addRelation(ctx, me, parentMethod, 'override', c);
        }
      } else if (c.kind() === 'field_declaration') {
        for (const vd of c.children()) if (vd.kind() === 'variable_declarator') {
          const fn = findChildText(vd, 'identifier');
          const fe = fn ? entities.find(e => e.name === fn && e.kind === 'field' && e.qualified_name.includes(`${name}.`)) : null;
          if (fe) addRelation(ctx, cls, fe, 'contain', c);
        }
      }
      walk(c, cls);
    }
  }

  function handleIfaceRels(node: SgNode): void {
    const name = findChildText(node, 'identifier');
    const iface = name ? ctx.entityMap.get(name) : null;
    if (!iface) return;
    const body = findChild(node, 'interface_body');
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
    // throws
    const tc = findChild(node, 'throws');
    if (tc && cur) for (const c of tc.children()) {
      if (c.kind() === 'type_identifier') addRelationByName(ctx, cur, c.text(), 'throw', tc);
    }
    annotationRels(node, cur);

    // Parameter type relations: method params referencing known entities
    const params = findChild(node, 'formal_parameters');
    if (params && cur) {
      for (const p of params.children()) {
        if (p.kind() === 'formal_parameter' || p.kind() === 'spread_parameter') {
          const typeId = findChildText(p, 'type_identifier');
          if (typeId) {
            const target = ctx.entityMap.get(typeId);
            if (target && (target.kind === 'class' || target.kind === 'interface' || target.kind === 'enum')) {
              addRelation(ctx, cur, target, 'parameter', p);
            }
          }
        }
      }
    }

    // Return type relation: first type_identifier child of method_declaration
    if (cur) {
      for (const c of node.children()) {
        if (c.kind() === 'type_identifier') {
          const target = ctx.entityMap.get(c.text());
          if (target && (target.kind === 'class' || target.kind === 'interface' || target.kind === 'enum')) {
            addRelation(ctx, cur, target, 'return', c);
          }
          break; // First type_identifier is the return type
        }
      }
    }

    for (const c of node.children()) walk(c, cur);
  }

  function annotationRels(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() === 'marker_annotation' || c.kind() === 'annotation') {
        const an = findChildText(c, 'identifier');
        const de = an ? entities.find(e => e.kind === 'decorator' && e.name === an) : null;
        if (de) addRelation(ctx, de, cur, 'decorate', c);
      }
    }
  }

  function handleCreate(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const tn = findChildText(node, 'type_identifier');
    if (tn) addRelationByName(ctx, cur, tn, 'create', node);
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const name = findChildText(node, 'identifier');
    if (!name) return;
    const t = ctx.entityMap.get(name);
    if (t && (t.kind === 'method' || t.kind === 'function')) addRelation(ctx, cur, t, 'call', node);
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const javaExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.java'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement', 'override',
    'use', 'contain', 'create', 'parameter', 'return', 'throw', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
