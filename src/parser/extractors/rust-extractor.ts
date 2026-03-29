/**
 * Rust language extractor.
 *
 * Extracts entities (structs, enums, traits/interfaces, functions, methods,
 * fields, variables, enum members) and relations (import, call, use, contain,
 * create, implement) from Rust ASTs parsed by tree-sitter.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import {
  createRelationContext, addRelation, addRelationByName,
  addImportRelation, type RelationContext,
} from './relation-builder.js';

const LANG = 'rust';

/** Rust visibility: `pub` = public, otherwise internal. */
function rustVis(node: SgNode): Visibility {
  const vis = findChild(node, 'visibility_modifier');
  return vis ? 'public' : 'internal';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[]): void {
    for (const c of node.children()) visit(c, parents);
  }

  function visit(node: SgNode, parents: string[]): void {
    switch (node.kind()) {
      case 'struct_item': handleStruct(node, parents); break;
      case 'enum_item': handleEnum(node, parents); break;
      case 'trait_item': handleTrait(node, parents); break;
      case 'function_item': handleFunction(node, parents); break;
      case 'impl_item': handleImpl(node, parents); break;
      case 'let_declaration': handleLet(node, parents); break;
      case 'const_item': handleConst(node, parents); break;
      case 'static_item': handleStatic(node, parents); break;
      default: walk(node, parents);
    }
  }

  function handleStruct(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', rustVis(node), fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) {
      for (const c of fdl.children()) {
        if (c.kind() !== 'field_declaration') continue;
        const fname = findChildText(c, 'field_identifier');
        if (fname) {
          const vis = findChild(c, 'visibility_modifier') ? 'public' : 'internal';
          out.push(makeEntity(c, fname, 'field', vis, fp, LANG, [...parents, name]));
        }
      }
    }
  }

  function handleEnum(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'enum', rustVis(node), fp, LANG, parents));
    const variants = findChild(node, 'enum_variant_list');
    if (!variants) return;
    for (const c of variants.children()) {
      if (c.kind() !== 'enum_variant') continue;
      const vname = findChildText(c, 'identifier');
      if (vname) {
        out.push(makeEntity(c, vname, 'enum_member', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleTrait(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'interface', rustVis(node), fp, LANG, parents));
    const dl = findChild(node, 'declaration_list');
    if (dl) {
      for (const c of dl.children()) {
        if (c.kind() === 'function_signature_item' || c.kind() === 'function_item') {
          const mn = findChildText(c, 'identifier');
          if (mn) {
            out.push(makeEntity(c, mn, 'method', 'public', fp, LANG, [...parents, name]));
          }
        }
      }
    }
  }

  function handleFunction(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', rustVis(node), fp, LANG, parents));
  }

  function handleImpl(node: SgNode, parents: string[]): void {
    // Find the type being implemented
    const typeIds = node.children().filter(
      (c: SgNode) => c.kind() === 'type_identifier',
    );
    // impl Trait for Type -> 2 type_identifiers (trait, type)
    // impl Type -> 1 type_identifier
    const implType = typeIds.length >= 2 ? typeIds[1].text() : typeIds[0]?.text();
    if (!implType) return;

    const dl = findChild(node, 'declaration_list');
    if (!dl) return;
    for (const c of dl.children()) {
      if (c.kind() === 'function_item') {
        const mn = findChildText(c, 'identifier');
        if (mn) {
          out.push(makeEntity(c, mn, 'method', rustVis(c), fp, LANG, [...parents, implType]));
        }
      }
    }
  }

  function handleLet(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name || name === '_') return;
    out.push(makeEntity(node, name, 'variable', 'internal', fp, LANG, parents));
  }

  function handleConst(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'variable', rustVis(node), fp, LANG, parents));
  }

  function handleStatic(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'variable', rustVis(node), fp, LANG, parents));
  }

  walk(root, []);
  return out;
}

// ─── Relation Extraction ────────────────────────────────────────

function extractRelations(
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

// ─── Export ─────────────────────────────────────────────────────

export const rustExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.rs'],
  supportedRelationTypes: [
    'import', 'call', 'use', 'contain', 'create', 'implement',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
