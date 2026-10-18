/**
 * Kotlin relation extraction (split from kotlin-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { createRelationContext, addRelation, addRelationByName, addImportRelation, handleCallOrCreate, findMethodEntity } from './relation-builder.js';

// ─── Relation Extraction ────────────────────────────────────────

export function extractRelations(
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
      handleFuncRels(node, cur, null);
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
    // Use detection: simple_identifier or navigation_expression referencing a field/variable
    else if (k === 'navigation_expression' && cur) {
      const fname = findChildText(node, 'simple_identifier');
      if (fname) {
        const target = entities.find(e => e.name === fname && (e.kind === 'field' || e.kind === 'variable'));
        if (target) addRelation(ctx, cur, target, 'use', node);
      }
    }
    else if (k === 'simple_identifier' && cur) {
      const parentKind = node.parent()?.kind();
      if (parentKind !== 'call_expression' && parentKind !== 'function_declaration'
        && parentKind !== 'variable_declaration' && parentKind !== 'property_declaration'
        && parentKind !== 'class_declaration' && parentKind !== 'type_identifier'
        && parentKind !== 'user_type' && parentKind !== 'parameter'
        && parentKind !== 'navigation_expression') {
        const target = entities.find(e => e.name === node.text() && (e.kind === 'field' || e.kind === 'variable'));
        if (target) addRelation(ctx, cur, target, 'use', node);
      }
    }
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    // Collect parent class name for override detection
    let parentClassName: string | null = null;
    for (const c of node.children()) {
      if (c.kind() === 'delegation_specifier') {
        const ci = findChild(c, 'constructor_invocation');
        if (ci) {
          const ut = findChild(ci, 'user_type');
          const bn = ut ? findChildText(ut, 'type_identifier') : null;
          if (bn) { addRelationByName(ctx, cls, bn, 'extend', c); parentClassName = bn; }
        } else {
          const ut = findChild(c, 'user_type');
          const in_ = ut ? findChildText(ut, 'type_identifier') : null;
          if (in_) addRelationByName(ctx, cls, in_, 'implement', c);
        }
      }
    }
    annotationRels(node, cls);

    // Store parent entity for override detection in nested function_declaration
    const parentEntity = parentClassName ? ctx.entityMap.get(parentClassName) ?? null : null;
    const body = findChild(node, 'class_body');
    if (body) for (const c of body.children()) {
      if (c.kind() === 'function_declaration') {
        handleFuncRels(c, cls, parentEntity);
      } else {
        walk(c, cls);
      }
    }
  }

  function handleFuncRels(
    node: SgNode, parent: Entity | null, classParentEntity: Entity | null,
  ): void {
    const name = findChildText(node, 'simple_identifier');
    const fn = name ? findMethodEntity(ctx, name, parent) : null;
    if (parent && fn) addRelation(ctx, parent, fn, 'contain', node);
    annotationRels(node, fn ?? parent);

    // Override detection: check if function has 'override' modifier
    if (fn && classParentEntity) {
      const mods = findChild(node, 'modifiers');
      if (mods) {
        for (const m of mods.children()) {
          if (m.kind() === 'member_modifier' && m.text().trim() === 'override') {
            const parentMethod = findMethodEntity(ctx, name!, classParentEntity);
            if (parentMethod) addRelation(ctx, fn, parentMethod, 'override', node);
            break;
          }
        }
      }
    }

    const cur = fn ?? parent;

    // Parameter type relations
    const params = findChild(node, 'function_value_parameters');
    if (params && cur) {
      for (const p of params.children()) {
        if (p.kind() === 'parameter') {
          const ut = findChild(p, 'user_type');
          const typeId = ut ? findChildText(ut, 'type_identifier') : null;
          if (typeId) {
            const target = ctx.entityMap.get(typeId);
            if (target && (target.kind === 'class' || target.kind === 'interface' || target.kind === 'enum')) {
              addRelation(ctx, cur, target, 'parameter', p);
            }
          }
        }
      }
    }

    // Return type relation
    if (cur) {
      const ut = findChild(node, 'user_type');
      if (ut) {
        const typeId = findChildText(ut, 'type_identifier');
        if (typeId) {
          const target = ctx.entityMap.get(typeId);
          if (target && (target.kind === 'class' || target.kind === 'interface' || target.kind === 'enum')) {
            addRelation(ctx, cur, target, 'return', ut);
          }
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
