/**
 * C++ language extractor.
 *
 * Extends C patterns with classes, namespaces, inheritance, and new-expressions.
 * Extracts entities (classes, namespaces, functions, methods, fields, variables)
 * and relations (import, call, extend, use, contain, create).
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

const LANG = 'cpp';

/** Resolve visibility from the last access_specifier seen before this node. */
function cppMemberVis(node: SgNode): Visibility {
  // Walk backwards through siblings to find the nearest access_specifier
  let prev = node.prev();
  while (prev) {
    if (prev.kind() === 'access_specifier') {
      const text = prev.text().replace(':', '').trim();
      if (text === 'public') return 'public';
      if (text === 'private') return 'private';
      if (text === 'protected') return 'protected';
    }
    prev = prev.prev();
  }
  // C++ class members are private by default
  return 'private';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_specifier': handleClass(node, parents); break;
      case 'struct_specifier': handleStruct(node, parents); break;
      case 'namespace_definition': handleNamespace(node, parents); break;
      case 'function_definition': handleFunction(node, parents, inClass); break;
      case 'declaration': handleDeclaration(node, parents, inClass); break;
      case 'field_declaration': handleField(node, parents); break;
      case 'preproc_include': break; // relations only
      default: walk(node, parents, inClass);
    }
  }

  function handleClass(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) walk(fdl, [...parents, name], true);
  }

  function handleStruct(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) walk(fdl, [...parents, name], true);
  }

  function handleNamespace(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'namespace_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'namespace', 'public', fp, LANG, parents));
    const dl = findChild(node, 'declaration_list');
    if (dl) walk(dl, [...parents, name], false);
  }

  function handleFunction(node: SgNode, parents: string[], inClass: boolean): void {
    const decl = findChild(node, 'function_declarator');
    if (!decl) return;
    // method if inside class or has field_identifier
    const fieldId = findChildText(decl, 'field_identifier');
    const id = findChildText(decl, 'identifier');
    const name = fieldId ?? id;
    if (!name) return;

    const kind: EntityKind = inClass ? 'method' : 'function';
    const vis: Visibility = inClass ? cppMemberVis(node) : 'public';
    out.push(makeEntity(node, name, kind, vis, fp, LANG, parents));
  }

  function handleField(node: SgNode, parents: string[]): void {
    // Field declaration inside a class (with field_identifier or identifier)
    const fid = findChildText(node, 'field_identifier');
    if (fid) {
      out.push(makeEntity(node, fid, 'field', cppMemberVis(node), fp, LANG, parents));
      return;
    }
    // Check for function_declarator (method declaration, not field)
    if (findChild(node, 'function_declarator')) return;
  }

  function handleDeclaration(node: SgNode, parents: string[], inClass: boolean): void {
    // Check for nested class/struct
    const classSpec = findChild(node, 'class_specifier');
    if (classSpec) { handleClass(classSpec, parents); return; }
    const structSpec = findChild(node, 'struct_specifier');
    if (structSpec) { handleStruct(structSpec, parents); return; }

    // Variable declaration
    const initDecl = findChild(node, 'init_declarator');
    if (initDecl) {
      const name = findChildText(initDecl, 'identifier');
      if (name) {
        const kind: EntityKind = inClass ? 'field' : 'variable';
        out.push(makeEntity(node, name, kind, 'public', fp, LANG, parents));
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

// ─── Export ─────────────────────────────────────────────────────

export const cppExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'use', 'contain', 'create',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
