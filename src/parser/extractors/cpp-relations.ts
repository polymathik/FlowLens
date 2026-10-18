/**
 * C++ relation extraction (split from cpp-extractor.ts in Phase 12;
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

    if (k === 'preproc_include') {
      addImportRelation(ctx, node);
    } else if (k === 'class_specifier' || k === 'struct_specifier') {
      handleClassRels(node);
      return;
    } else if (k === 'namespace_definition') {
      handleNamespaceRels(node, cur);
      return;
    } else if (k === 'function_definition') {
      handleFuncRels(node, cur);
      return;
    } else if (k === 'new_expression') {
      handleCreate(node, cur);
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'field_expression') {
      handleFieldUse(node, cur);
    }

    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    // extend: base_class_clause
    const baseClause = findChild(node, 'base_class_clause');
    if (baseClause) {
      for (const c of baseClause.children()) {
        if (c.kind() === 'type_identifier') {
          addRelationByName(ctx, cls, c.text(), 'extend', baseClause);
        }
      }
    }

    // contain members
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) {
      for (const c of fdl.children()) {
        if (c.kind() === 'function_definition') {
          const decl = findChild(c, 'function_declarator');
          const mn = decl
            ? (findChildText(decl, 'field_identifier') ?? findChildText(decl, 'identifier'))
            : null;
          const me = mn ? entities.find(
            e => e.name === mn && (e.kind === 'method' || e.kind === 'function')
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (me) addRelation(ctx, cls, me, 'contain', c);
          walk(c, me ?? cls);
        } else if (c.kind() === 'field_declaration') {
          const fn = findChildText(c, 'field_identifier');
          const fe = fn ? entities.find(
            e => e.name === fn && e.kind === 'field'
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (fe) addRelation(ctx, cls, fe, 'contain', c);
        } else {
          walk(c, cls);
        }
      }
    }
  }

  function handleNamespaceRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'namespace_identifier');
    const ns = name ? ctx.entityMap.get(name) : null;
    const dl = findChild(node, 'declaration_list');
    if (dl) {
      for (const c of dl.children()) {
        // Classes/structs inside namespace are "contained"
        if (c.kind() === 'class_specifier' || c.kind() === 'struct_specifier') {
          const cn = findChildText(c, 'type_identifier');
          const ce = cn ? ctx.entityMap.get(cn) : null;
          if (ns && ce) addRelation(ctx, ns, ce, 'contain', c);
        }
        walk(c, ns ?? _parent);
      }
    }
  }

  function handleFuncRels(node: SgNode, parent: Entity | null): void {
    const decl = findChild(node, 'function_declarator');
    const name = decl
      ? (findChildText(decl, 'field_identifier') ?? findChildText(decl, 'identifier'))
      : null;
    const fn = name ? entities.find(
      e => e.name === name && (e.kind === 'method' || e.kind === 'function'),
    ) : null;
    for (const c of node.children()) walk(c, fn ?? parent);
  }

  function handleCreate(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const tn = findChildText(node, 'type_identifier');
    if (tn) {
      const target = ctx.entityMap.get(tn);
      if (target && target.kind === 'class') {
        addRelation(ctx, cur, target, 'create', node);
      } else {
        addRelationByName(ctx, cur, tn, 'create', node);
      }
    }
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const id = findChild(node, 'identifier');
    if (id) {
      handleCallOrCreate(ctx, cur, id.text(), node);
      return;
    }
    // Scoped call: Namespace::func()
    const scoped = findChild(node, 'qualified_identifier');
    if (scoped) {
      const sid = findChildText(scoped, 'identifier');
      if (sid) {
        const target = ctx.entityMap.get(sid);
        if (target && (target.kind === 'function' || target.kind === 'method')) {
          addRelation(ctx, cur, target, 'call', node);
        }
      }
    }
    // Field call: obj.method()
    const fe = findChild(node, 'field_expression');
    if (fe) {
      const fid = findChildText(fe, 'field_identifier');
      if (fid) {
        const target = entities.find(
          e => e.name === fid && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target) addRelation(ctx, cur, target, 'call', node);
      }
    }
  }

  function handleFieldUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const parent = node.parent();
    if (parent && parent.kind() === 'call_expression') return;
    const fid = findChildText(node, 'field_identifier');
    if (fid) {
      const target = entities.find(e => e.name === fid && e.kind === 'field');
      if (target) addRelation(ctx, cur, target, 'use', node);
    }
  }

  walk(root, null);
  return ctx.relations;
}
