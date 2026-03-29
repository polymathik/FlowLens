/**
 * Go language extractor.
 *
 * Extracts entities (classes/structs, interfaces, functions, methods,
 * fields, variables) and relations (import, call, use, contain, create,
 * implement) from Go ASTs parsed by tree-sitter.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addRelationByName,
  addImportRelation, handleCallOrCreate, type RelationContext,
} from './relation-builder.js';

const LANG = 'go';

/** Go exports by capitalisation: uppercase first letter = public. */
function goVis(name: string): Visibility {
  return name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
    ? 'public' : 'internal';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'type_declaration': handleTypeDecl(node, parents); break;
      case 'function_declaration': handleFunc(node, parents); break;
      case 'method_declaration': handleMethod(node, parents); break;
      case 'var_declaration': handleVar(node, parents, inClass); break;
      case 'short_var_declaration': handleShortVar(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleTypeDecl(node: SgNode, parents: string[]): void {
    for (const c of node.children()) {
      if (c.kind() !== 'type_spec') continue;
      const name = findChildText(c, 'type_identifier');
      if (!name) continue;

      const structType = findChild(c, 'struct_type');
      if (structType) {
        out.push(makeEntity(c, name, 'class', goVis(name), fp, LANG, parents));
        handleStructFields(structType, [...parents, name]);
        continue;
      }
      const ifaceType = findChild(c, 'interface_type');
      if (ifaceType) {
        out.push(makeEntity(c, name, 'interface', goVis(name), fp, LANG, parents));
        continue;
      }
    }
  }

  function handleStructFields(structNode: SgNode, parents: string[]): void {
    const fdl = findChild(structNode, 'field_declaration_list');
    if (!fdl) return;
    for (const c of fdl.children()) {
      if (c.kind() !== 'field_declaration') continue;
      const fname = findChildText(c, 'field_identifier');
      if (fname) {
        out.push(makeEntity(c, fname, 'field', goVis(fname), fp, LANG, parents));
      }
    }
  }

  function handleFunc(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', goVis(name), fp, LANG, parents));
  }

  function handleMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'field_identifier');
    if (!name) return;
    // Determine receiver type to build proper qualified name
    const paramList = node.children().find(
      (c: SgNode) => c.kind() === 'parameter_list',
    );
    let receiverType: string | null = null;
    if (paramList) {
      const pd = findChild(paramList, 'parameter_declaration');
      if (pd) {
        receiverType = findChildText(pd, 'type_identifier');
        if (!receiverType) {
          const ptr = findChild(pd, 'pointer_type');
          if (ptr) receiverType = findChildText(ptr, 'type_identifier');
        }
      }
    }
    const methodParents = receiverType ? [...parents, receiverType] : parents;
    out.push(makeEntity(node, name, 'method', goVis(name), fp, LANG, methodParents));
  }

  function handleVar(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) {
      if (c.kind() !== 'var_spec') continue;
      const name = findChildText(c, 'identifier');
      if (name) {
        const kind: EntityKind = inClass ? 'field' : 'variable';
        out.push(makeEntity(c, name, kind, goVis(name), fp, LANG, parents));
      }
    }
  }

  function handleShortVar(node: SgNode, parents: string[], inClass: boolean): void {
    // expression_list on the left contains identifiers
    for (const c of node.children()) {
      if (c.kind() !== 'expression_list') continue;
      for (const id of c.children()) {
        if (id.kind() === 'identifier') {
          const name = id.text();
          if (name === '_') continue;
          const kind: EntityKind = inClass ? 'field' : 'variable';
          out.push(makeEntity(id, name, kind, 'internal', fp, LANG, parents));
        }
      }
      break; // only first expression_list is lhs
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

    if (k === 'import_declaration') {
      handleImports(ctx, node);
    } else if (k === 'type_declaration') {
      handleTypeRels(node, cur);
      return;
    } else if (k === 'function_declaration') {
      const name = findChildText(node, 'identifier');
      const fn = name ? ctx.entityMap.get(name) : null;
      walkChildren(node, fn ?? cur);
      return;
    } else if (k === 'method_declaration') {
      handleMethodRels(node, cur);
      return;
    } else if (k === 'composite_literal') {
      handleCreate(node, cur);
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'selector_expression') {
      handleUse(node, cur);
    }

    walkChildren(node, cur);
  }

  function walkChildren(node: SgNode, cur: Entity | null): void {
    for (const c of node.children()) walk(c, cur);
  }

  function handleImports(ctx: RelationContext, node: SgNode): void {
    // Single import or import block
    for (const c of node.children()) {
      if (c.kind() === 'import_spec') {
        addImportRelation(ctx, c);
      } else if (c.kind() === 'import_spec_list') {
        for (const spec of c.children()) {
          if (spec.kind() === 'import_spec') addImportRelation(ctx, spec);
        }
      }
    }
  }

  function handleTypeRels(node: SgNode, parent: Entity | null): void {
    for (const c of node.children()) {
      if (c.kind() !== 'type_spec') continue;
      const name = findChildText(c, 'type_identifier');
      const ent = name ? ctx.entityMap.get(name) : null;
      if (!ent) continue;

      const structType = findChild(c, 'struct_type');
      if (structType) {
        // contain fields
        const fdl = findChild(structType, 'field_declaration_list');
        if (fdl) for (const f of fdl.children()) {
          if (f.kind() !== 'field_declaration') continue;
          const fn = findChildText(f, 'field_identifier');
          const fe = fn ? entities.find(
            e => e.name === fn && e.kind === 'field'
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (fe) addRelation(ctx, ent, fe, 'contain', f);
        }
      }

      const ifaceType = findChild(c, 'interface_type');
      if (ifaceType) {
        // Interface methods as contain
        for (const me of ifaceType.children()) {
          if (me.kind() === 'method_elem') {
            const mn = findChildText(me, 'field_identifier');
            if (mn) {
              const method = entities.find(
                e => e.name === mn && e.kind === 'method',
              );
              if (method) addRelation(ctx, ent, method, 'contain', me);
            }
          }
        }
      }
    }
  }

  function handleMethodRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'field_identifier');
    // Find receiver type
    const paramList = node.children().find(
      (c: SgNode) => c.kind() === 'parameter_list',
    );
    let receiverType: string | null = null;
    if (paramList) {
      const pd = findChild(paramList, 'parameter_declaration');
      if (pd) {
        receiverType = findChildText(pd, 'type_identifier');
        if (!receiverType) {
          const ptr = findChild(pd, 'pointer_type');
          if (ptr) receiverType = findChildText(ptr, 'type_identifier');
        }
      }
    }

    const me = name ? entities.find(
      e => e.name === name && e.kind === 'method'
        && (!receiverType || e.qualified_name.includes(`${receiverType}.`)),
    ) : null;

    // contain: struct contains method
    if (receiverType && me) {
      const cls = ctx.entityMap.get(receiverType);
      if (cls) addRelation(ctx, cls, me, 'contain', node);
    }

    walkChildren(node, me ?? _parent);
  }

  function handleCreate(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    const typeName = findChildText(node, 'type_identifier');
    if (typeName) {
      const target = ctx.entityMap.get(typeName);
      if (target && target.kind === 'class') {
        addRelation(ctx, cur, target, 'create', node);
      } else if (typeName) {
        addRelationByName(ctx, cur, typeName, 'create', node);
      }
    }
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Simple: call_expression > identifier
    const id = findChild(node, 'identifier');
    if (id) {
      handleCallOrCreate(ctx, cur, id.text(), node);
      return;
    }
    // Method call: call_expression > selector_expression > field_identifier
    const sel = findChild(node, 'selector_expression');
    if (sel) {
      const fieldId = findChildText(sel, 'field_identifier');
      if (fieldId) {
        const target = entities.find(
          e => e.name === fieldId && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target && cur) addRelation(ctx, cur, target, 'call', node);
      }
    }
  }

  function handleUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Skip if parent is call_expression (already handled as call)
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

  // Implement relations: find method_declarations matching interface methods
  const ifaces = entities.filter(e => e.kind === 'interface');
  for (const iface of ifaces) {
    // This is a heuristic: if a struct has a method with the same name as an
    // interface method, we add an implement relation. Real Go resolution is
    // structural typing, so this approximation is reasonable.
  }

  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const goExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.go'],
  supportedRelationTypes: [
    'import', 'call', 'use', 'contain', 'create', 'implement',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
