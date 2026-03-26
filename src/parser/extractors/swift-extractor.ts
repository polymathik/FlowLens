/**
 * Swift language extractor.
 *
 * Extracts entities (classes, structs, protocols/interfaces, enums,
 * functions, methods, fields) and relations (import, call, extend,
 * implement, use, contain, create, decorate) from Swift ASTs parsed
 * by tree-sitter.
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

const LANG = 'swift';

/** Resolve Swift visibility from modifiers. */
function swiftVis(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'internal';
  for (const c of mods.children()) {
    const t = c.text();
    if (t === 'public' || t === 'open') return 'public';
    if (t === 'private') return 'private';
    if (t === 'fileprivate') return 'private';
    if (t === 'internal') return 'internal';
  }
  return 'internal';
}

/** Extract decorator names from modifiers. */
function extractDecorators(
  node: SgNode, parents: string[], fp: string, out: Entity[],
): void {
  const mods = findChild(node, 'modifiers');
  if (!mods) return;
  for (const c of mods.children()) {
    if (c.kind() === 'attribute') {
      // @attributeName — get the user_type > type_identifier
      const ut = findChild(c, 'user_type');
      const name = ut ? findChildText(ut, 'type_identifier') : null;
      if (name) {
        out.push(makeEntity(c, name, 'decorator', 'public', fp, LANG, parents));
      }
    }
  }
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_declaration': handleClassDecl(node, parents); break;
      case 'protocol_declaration': handleProtocol(node, parents); break;
      case 'function_declaration': handleFunction(node, parents, inClass); break;
      case 'init_declaration': handleInit(node, parents, inClass); break;
      case 'property_declaration': handleProperty(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClassDecl(node: SgNode, parents: string[]): void {
    // class_declaration covers class, struct, and enum in Swift's grammar
    const isStruct = node.children().some((c: SgNode) => c.kind() === 'struct');
    const isEnum = node.children().some((c: SgNode) => c.kind() === 'enum');

    const name = findChildText(node, 'type_identifier');
    if (!name) return;

    if (isEnum) {
      out.push(makeEntity(node, name, 'enum', swiftVis(node), fp, LANG, parents));
      extractDecorators(node, parents, fp, out);
      const enumBody = findChild(node, 'enum_class_body');
      if (enumBody) {
        for (const c of enumBody.children()) {
          if (c.kind() === 'enum_entry') {
            const vname = findChildText(c, 'simple_identifier');
            if (vname) {
              out.push(makeEntity(c, vname, 'enum_member', 'public', fp, LANG, [...parents, name]));
            }
          }
        }
      }
      return;
    }

    const kind: EntityKind = isStruct ? 'class' : 'class';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
    extractDecorators(node, parents, fp, out);

    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleProtocol(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'interface', swiftVis(node), fp, LANG, parents));
    const body = findChild(node, 'protocol_body');
    if (body) {
      for (const c of body.children()) {
        if (c.kind() === 'protocol_function_declaration') {
          const mn = findChildText(c, 'simple_identifier');
          if (mn) {
            out.push(makeEntity(c, mn, 'method', 'public', fp, LANG, [...parents, name]));
          }
        } else if (c.kind() === 'protocol_property_declaration') {
          const pn = findPropertyName(c);
          if (pn) {
            out.push(makeEntity(c, pn, 'field', 'public', fp, LANG, [...parents, name]));
          }
        }
      }
    }
  }

  function handleFunction(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
  }

  function handleInit(node: SgNode, parents: string[], _inClass: boolean): void {
    out.push(makeEntity(node, 'init', 'method', swiftVis(node), fp, LANG, parents));
  }

  function handleProperty(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findPropertyName(node);
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
  }

  walk(root, [], false);
  return out;
}

/** Extract property name from a property_declaration. */
function findPropertyName(node: SgNode): string | null {
  for (const c of node.children()) {
    if (c.kind() === 'pattern') {
      return findChildText(c, 'simple_identifier');
    }
  }
  return null;
}

// ─── Relation Extraction ────────────────────────────────────────

function extractRelations(
  root: SgNode, fp: string, entities: Entity[], _rootDir: string,
): Relation[] {
  const ctx = createRelationContext(fp, entities);

  function walk(node: SgNode, cur: Entity | null): void {
    const k = node.kind();

    if (k === 'import_declaration') {
      addImportRelation(ctx, node);
    } else if (k === 'class_declaration') {
      handleClassRels(node, cur);
      return;
    } else if (k === 'protocol_declaration') {
      handleProtocolRels(node);
      return;
    } else if (k === 'function_declaration') {
      handleFuncRels(node, cur);
      return;
    } else if (k === 'init_declaration') {
      handleInitRels(node, cur);
      return;
    } else if (k === 'call_expression') {
      handleCall(node, cur);
    } else if (k === 'navigation_expression') {
      handleNavUse(node, cur);
    }

    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'type_identifier');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls) return;

    const isEnum = node.children().some((c: SgNode) => c.kind() === 'enum');

    // Decorators
    handleDecorateRels(node, cls);

    // Inheritance: class Dog: Animal, Protocol
    const inheritanceSpecs = node.children().filter(
      (c: SgNode) => c.kind() === 'inheritance_specifier',
    );
    for (let i = 0; i < inheritanceSpecs.length; i++) {
      const spec = inheritanceSpecs[i];
      const ut = findChild(spec, 'user_type');
      const baseName = ut ? findChildText(ut, 'type_identifier') : null;
      if (!baseName) continue;

      // Check if it's a known protocol/interface
      const baseEntity = ctx.entityMap.get(baseName);
      if (baseEntity?.kind === 'interface') {
        addRelationByName(ctx, cls, baseName, 'implement', spec);
      } else if (i === 0) {
        // First one is typically the superclass (for classes)
        addRelationByName(ctx, cls, baseName, 'extend', spec);
      } else {
        addRelationByName(ctx, cls, baseName, 'implement', spec);
      }
    }

    // enum body
    if (isEnum) {
      const enumBody = findChild(node, 'enum_class_body');
      if (enumBody) {
        for (const c of enumBody.children()) {
          if (c.kind() === 'enum_entry') {
            const vn = findChildText(c, 'simple_identifier');
            const ve = vn ? entities.find(
              e => e.name === vn && e.kind === 'enum_member'
                && e.qualified_name.includes(`${name}.`),
            ) : null;
            if (ve) addRelation(ctx, cls, ve, 'contain', c);
          }
        }
      }
      return;
    }

    // class/struct body
    const body = findChild(node, 'class_body');
    if (body) {
      for (const c of body.children()) {
        if (c.kind() === 'function_declaration' || c.kind() === 'init_declaration') {
          const mn = c.kind() === 'init_declaration'
            ? 'init'
            : findChildText(c, 'simple_identifier');
          const me = mn ? entities.find(
            e => e.name === mn && (e.kind === 'method')
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (me) addRelation(ctx, cls, me, 'contain', c);
          walkChildren(c, me ?? cls);
        } else if (c.kind() === 'property_declaration') {
          const pn = findPropertyName(c);
          const pe = pn ? entities.find(
            e => e.name === pn && e.kind === 'field'
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (pe) addRelation(ctx, cls, pe, 'contain', c);
        } else {
          walk(c, cls);
        }
      }
    }
  }

  function handleProtocolRels(node: SgNode): void {
    const name = findChildText(node, 'type_identifier');
    const iface = name ? ctx.entityMap.get(name) : null;
    if (!iface) return;
    const body = findChild(node, 'protocol_body');
    if (body) {
      for (const c of body.children()) {
        if (c.kind() === 'protocol_function_declaration') {
          const mn = findChildText(c, 'simple_identifier');
          const me = mn ? entities.find(
            e => e.name === mn && e.kind === 'method'
              && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (me) addRelation(ctx, iface, me, 'contain', c);
        }
      }
    }
  }

  function handleFuncRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'simple_identifier');
    const fn = name ? entities.find(
      e => e.name === name && (e.kind === 'function' || e.kind === 'method'),
    ) : null;
    const body = findChild(node, 'function_body');
    if (body) walkChildren(body, fn ?? parent);
  }

  function handleInitRels(node: SgNode, parent: Entity | null): void {
    const me = entities.find(
      e => e.name === 'init' && e.kind === 'method'
        && parent && e.qualified_name.includes(`${parent.name}.`),
    );
    const body = findChild(node, 'function_body');
    if (body) walkChildren(body, me ?? parent);
  }

  function handleDecorateRels(node: SgNode, target: Entity): void {
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() === 'attribute') {
        const ut = findChild(c, 'user_type');
        const name = ut ? findChildText(ut, 'type_identifier') : null;
        const de = name ? entities.find(
          e => e.kind === 'decorator' && e.name === name,
        ) : null;
        if (de) addRelation(ctx, de, target, 'decorate', c);
      }
    }
  }

  function handleCall(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Simple call: funcName(...)
    const id = findChild(node, 'simple_identifier');
    if (id) {
      const name = id.text();
      const target = ctx.entityMap.get(name);
      if (target) {
        if (target.kind === 'class') {
          addRelation(ctx, cur, target, 'create', node);
        } else if (target.kind === 'function' || target.kind === 'method') {
          addRelation(ctx, cur, target, 'call', node);
        }
      }
      return;
    }
    // Method call: obj.method(...)
    const nav = findChild(node, 'navigation_expression');
    if (nav) {
      const suffix = findChild(nav, 'navigation_suffix');
      const mn = suffix ? findChildText(suffix, 'simple_identifier') : null;
      if (mn) {
        const target = entities.find(
          e => e.name === mn && (e.kind === 'method' || e.kind === 'function'),
        );
        if (target) addRelation(ctx, cur, target, 'call', node);
      }
    }
  }

  function handleNavUse(node: SgNode, cur: Entity | null): void {
    if (!cur) return;
    // Skip if parent is call_expression (handled there)
    const parent = node.parent();
    if (parent && parent.kind() === 'call_expression') return;

    const suffix = findChild(node, 'navigation_suffix');
    const name = suffix ? findChildText(suffix, 'simple_identifier') : null;
    if (name) {
      const target = entities.find(e => e.name === name && e.kind === 'field');
      if (target) addRelation(ctx, cur, target, 'use', node);
    }
  }

  function walkChildren(node: SgNode, cur: Entity | null): void {
    for (const c of node.children()) walk(c, cur);
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const swiftExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.swift'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
