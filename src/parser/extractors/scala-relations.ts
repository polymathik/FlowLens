/**
 * Scala relation extraction (split from scala-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { createRelationContext, addRelation, addRelationByName, addImportRelation, handleCallOrCreate } from './relation-builder.js';

// ─── Relation Extraction ────────────────────────────────────────

export function extractRelations(
  root: SgNode, fp: string, entities: Entity[], _rootDir: string,
): Relation[] {
  const ctx = createRelationContext(fp, entities);

  function walk(node: SgNode, cur: Entity | null): void {
    const k = node.kind();

    if (k === 'import_declaration') {
      addImportRelation(ctx, node);
    } else if (k === 'class_definition') {
      handleClassRels(node, cur);
      return;
    } else if (k === 'trait_definition') {
      handleTraitRels(node);
      return;
    } else if (k === 'object_definition') {
      handleObjectRels(node, cur);
      return;
    } else if (k === 'function_definition') {
      handleFuncRels(node, cur);
      return;
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'instance_expression') {
      handleCreate(node, cur);
    } else if (k === 'field_expression') {
      handleFieldUse(node, cur);
    }

    walkChildren(node, cur);
  }

  function walkChildren(node: SgNode, cur: Entity | null): void {
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    // Annotations → decorate
    handleDecorateRels(node, cls);

    // Inheritance: extends_clause
    const extendsClause = findChild(node, 'extends_clause');
    if (extendsClause) handleInheritance(extendsClause, cls);

    // Contain fields from class_parameters
    const classParams = findChild(node, 'class_parameters');
    if (classParams) {
      for (const c of classParams.children()) {
        if (c.kind() === 'class_parameter') {
          const pname = findChildText(c, 'identifier');
          const fe = pname ? entities.find(
            e => e.name === pname && e.kind === 'field'
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (fe) addRelation(ctx, cls, fe, 'contain', c);
        }
      }
    }

    // Body members
    const body = findChild(node, 'template_body');
    if (body) handleBodyMembers(body, cls, name!);
  }

  function handleTraitRels(node: SgNode): void {
    const name = findChildText(node, 'identifier');
    const iface = name ? ctx.entityMap.get(name) : null;
    if (!iface || !name) return;

    handleDecorateRels(node, iface);

    const extendsClause = findChild(node, 'extends_clause');
    if (extendsClause) handleInheritance(extendsClause, iface);

    const body = findChild(node, 'template_body');
    if (body) handleBodyMembers(body, iface, name);
  }

  function handleObjectRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const obj = name ? ctx.entityMap.get(name) : null;
    if (!obj || !name) return;

    handleDecorateRels(node, obj);

    const extendsClause = findChild(node, 'extends_clause');
    if (extendsClause) handleInheritance(extendsClause, obj);

    const body = findChild(node, 'template_body');
    if (body) handleBodyMembers(body, obj, name);
  }

  function handleInheritance(clause: SgNode, entity: Entity): void {
    let first = true;
    for (const c of clause.children()) {
      if (c.kind() === 'type_identifier') {
        const baseName = c.text();
        const baseEntity = ctx.entityMap.get(baseName);
        if (baseEntity?.kind === 'interface') {
          addRelationByName(ctx, entity, baseName, 'implement', c);
        } else if (first) {
          addRelationByName(ctx, entity, baseName, 'extend', c);
        } else {
          addRelationByName(ctx, entity, baseName, 'implement', c);
        }
        first = false;
      }
    }
  }

  function handleBodyMembers(
    body: SgNode, owner: Entity, ownerName: string,
  ): void {
    for (const c of body.children()) {
      const ck = c.kind();
      if (ck === 'function_definition' || ck === 'function_declaration') {
        const mn = findChildText(c, 'identifier');
        const me = mn ? entities.find(
          e => e.name === mn && (e.kind === 'method' || e.kind === 'function')
            && e.qualified_name.includes(`${ownerName}.`),
        ) : null;
        if (me) addRelation(ctx, owner, me, 'contain', c);
        walkChildren(c, me ?? owner);
      } else if (ck === 'val_definition' || ck === 'var_definition') {
        const fn = findChildText(c, 'identifier');
        const fe = fn ? entities.find(
          e => e.name === fn && e.kind === 'field'
            && e.qualified_name.includes(`${ownerName}.`),
        ) : null;
        if (fe) addRelation(ctx, owner, fe, 'contain', c);
        walkChildren(c, owner);
      } else {
        walk(c, owner);
      }
    }
  }

  function handleDecorateRels(node: SgNode, target: Entity): void {
    for (const c of node.children()) {
      if (c.kind() === 'annotation') {
        const aname = findChildText(c, 'type_identifier')
          ?? findChildText(c, 'identifier');
        const de = aname ? entities.find(
          e => e.kind === 'decorator' && e.name === aname,
        ) : null;
        if (de) addRelation(ctx, de, target, 'decorate', c);
      }
    }
  }

  function handleFuncRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const fn = name ? entities.find(
      e => e.name === name && (e.kind === 'function' || e.kind === 'method'),
    ) : null;
    walkChildren(node, fn ?? parent);
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Simple call: call_expression > identifier
    const id = findChild(node, 'identifier');
    if (id) {
      handleCallOrCreate(ctx, cur, id.text(), node);
      return;
    }
    // Method call: call_expression > field_expression > identifier (last)
    const fe = findChild(node, 'field_expression');
    if (fe) {
      const children = fe.children();
      const lastId = children.filter((c: SgNode) => c.kind() === 'identifier').pop();
      if (lastId) {
        const target = entities.find(
          e => e.name === lastId.text()
            && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target) addRelation(ctx, cur, target, 'call', node);
      }
    }
  }

  function handleCreate(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // instance_expression > type_identifier
    const typeName = findChildText(node, 'type_identifier');
    if (typeName) {
      const target = ctx.entityMap.get(typeName);
      if (target && target.kind === 'class') {
        addRelation(ctx, cur, target, 'create', node);
      } else {
        addRelationByName(ctx, cur, typeName, 'create', node);
      }
    }
  }

  function handleFieldUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Skip if parent is call_expression (handled as call)
    const parent = node.parent();
    if (parent && parent.kind() === 'call_expression') return;

    const children = node.children();
    const lastId = children.filter((c: SgNode) => c.kind() === 'identifier').pop();
    if (lastId) {
      const target = entities.find(
        e => e.name === lastId.text() && e.kind === 'field',
      );
      if (target) addRelation(ctx, cur, target, 'use', node);
    }
  }

  walk(root, null);
  return ctx.relations;
}
