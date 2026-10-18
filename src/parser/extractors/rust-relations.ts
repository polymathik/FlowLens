/**
 * Rust relation extraction (split from rust-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { createRelationContext, addRelation, addRelationByName, addImportRelation } from './relation-builder.js';

// ─── Relation Extraction ────────────────────────────────────────

export function extractRelations(
  root: SgNode, fp: string, entities: Entity[], _rootDir: string,
): Relation[] {
  const ctx = createRelationContext(fp, entities);

  function walk(node: SgNode, cur: Entity | null): void {
    const k = node.kind();

    if (k === 'use_declaration') {
      addImportRelation(ctx, node);
    } else if (k === 'mod_item') {
      addImportRelation(ctx, node);
    } else if (k === 'struct_item') {
      handleStructRels(node);
    } else if (k === 'impl_item') {
      handleImplRels(node, cur);
      return;
    } else if (k === 'function_item') {
      const name = findChildText(node, 'identifier');
      const fn = name ? ctx.entityMap.get(name) : null;
      walkChildren(node, fn ?? cur);
      return;
    } else if (k === 'struct_expression') {
      handleStructCreate(node, cur);
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'field_expression') {
      handleFieldUse(node, cur);
    }

    walkChildren(node, cur);
  }

  function walkChildren(node: SgNode, cur: Entity | null): void {
    for (const c of node.children()) walk(c, cur);
  }

  function handleStructRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const ent = name ? ctx.entityMap.get(name) : null;
    if (!ent) return;
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) for (const c of fdl.children()) {
      if (c.kind() !== 'field_declaration') continue;
      const fn = findChildText(c, 'field_identifier');
      const fe = fn ? entities.find(
        e => e.name === fn && e.kind === 'field'
          && e.qualified_name.includes(`${name}.`),
      ) : null;
      if (fe) addRelation(ctx, ent, fe, 'contain', c);
    }
  }

  function handleImplRels(node: SgNode, parent: Entity | null): void {
    const typeIds = node.children().filter(
      (c: SgNode) => c.kind() === 'type_identifier',
    );
    const hasTrait = findChild(node, 'for') !== null;
    let traitName: string | null = null;
    let implType: string | null = null;

    if (hasTrait && typeIds.length >= 2) {
      traitName = typeIds[0].text();
      implType = typeIds[1].text();
    } else if (typeIds.length >= 1) {
      implType = typeIds[0].text();
    }

    const implEntity = implType ? ctx.entityMap.get(implType) : null;

    // implement relation
    if (traitName && implEntity) {
      addRelationByName(ctx, implEntity, traitName, 'implement', node);
    }

    // contain + walk methods
    const dl = findChild(node, 'declaration_list');
    if (dl && implEntity) {
      for (const c of dl.children()) {
        if (c.kind() === 'function_item') {
          const mn = findChildText(c, 'identifier');
          const me = mn ? entities.find(
            e => e.name === mn && e.kind === 'method'
              && e.qualified_name.includes(`${implType}.`),
          ) : null;
          if (me) addRelation(ctx, implEntity, me, 'contain', c);
          walkChildren(c, me ?? implEntity);
        } else {
          walk(c, implEntity);
        }
      }
    }
  }

  function handleStructCreate(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const typeName = findChildText(node, 'type_identifier');
    if (!typeName) return;
    const target = ctx.entityMap.get(typeName);
    if (target && target.kind === 'class') {
      addRelation(ctx, cur, target, 'create', node);
    } else {
      addRelationByName(ctx, cur, typeName, 'create', node);
    }
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const id = findChild(node, 'identifier');
    if (id) {
      const target = ctx.entityMap.get(id.text());
      if (target && (target.kind === 'function' || target.kind === 'method')) {
        addRelation(ctx, cur, target, 'call', node);
      }
      return;
    }
    // Scoped call: Dog::new(...)
    const scoped = findChild(node, 'scoped_identifier');
    if (scoped) {
      const ids = scoped.children().filter(
        (c: SgNode) => c.kind() === 'identifier',
      );
      const methodName = ids.length > 0 ? ids[ids.length - 1].text() : null;
      if (methodName) {
        const target = entities.find(
          e => e.name === methodName && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target) addRelation(ctx, cur, target, 'call', node);
      }
    }
    // Field call: d.speak()
    const fe = findChild(node, 'field_expression');
    if (fe) {
      const fieldId = findChildText(fe, 'field_identifier');
      if (fieldId) {
        const target = entities.find(
          e => e.name === fieldId && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target && cur) addRelation(ctx, cur, target, 'call', node);
      }
    }
  }

  function handleFieldUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Skip if parent is call_expression (already handled)
    const parent = node.parent();
    if (parent && parent.kind() === 'call_expression') return;

    const fieldId = findChildText(node, 'field_identifier');
    if (fieldId) {
      const target = entities.find(
        e => e.name === fieldId && e.kind === 'field',
      );
      if (target) addRelation(ctx, cur, target, 'use', node);
    }
  }

  walk(root, null);
  return ctx.relations;
}
