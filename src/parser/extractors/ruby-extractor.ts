/**
 * Ruby language extractor.
 *
 * Extracts entities (classes, modules/namespaces, methods, variables,
 * fields) and relations (import/require, call, extend, mixin, use,
 * contain, create) from Ruby ASTs parsed by tree-sitter.
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

const LANG = 'ruby';

/** Resolve Ruby visibility — default is public. */
function rubyVis(name: string): Visibility {
  return name.startsWith('_') ? 'private' : 'public';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class': handleClass(node, parents); break;
      case 'module': handleModule(node, parents); break;
      case 'method': handleMethod(node, parents, inClass); break;
      case 'singleton_method': handleSingletonMethod(node, parents); break;
      case 'assignment': handleAssignment(node, parents, inClass); break;
      case 'call': handleCallEntity(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClass(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'constant');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const body = findChild(node, 'body_statement');
    if (body) walk(body, [...parents, name], true);
  }

  function handleModule(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'constant');
    if (!name) return;
    out.push(makeEntity(node, name, 'namespace', 'public', fp, LANG, parents));
    const body = findChild(node, 'body_statement');
    if (body) walk(body, [...parents, name], true);
  }

  function handleMethod(
    node: SgNode, parents: string[], inClass: boolean,
  ): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, rubyVis(name), fp, LANG, parents));
  }

  function handleSingletonMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', 'public', fp, LANG, parents));
  }

  function handleAssignment(
    node: SgNode, parents: string[], inClass: boolean,
  ): void {
    const name = findChildText(node, 'identifier')
      ?? findChildText(node, 'instance_variable')
      ?? findChildText(node, 'constant');
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, rubyVis(name), fp, LANG, parents));
  }

  /** Extract attr_accessor/attr_reader/attr_writer fields. */
  function handleCallEntity(
    node: SgNode, parents: string[], inClass: boolean,
  ): void {
    if (!inClass) {
      walk(node, parents, inClass);
      return;
    }
    const methodName = findChildText(node, 'identifier');
    if (!methodName) return;
    if (
      methodName === 'attr_accessor'
      || methodName === 'attr_reader'
      || methodName === 'attr_writer'
    ) {
      const argList = findChild(node, 'argument_list');
      if (argList) {
        for (const c of argList.children()) {
          if (c.kind() === 'simple_symbol') {
            // :name → name
            const fieldName = c.text().replace(/^:/, '');
            out.push(makeEntity(c, fieldName, 'field', 'public', fp, LANG, parents));
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

    if (k === 'class') {
      handleClassRels(node, cur);
      return;
    } else if (k === 'module') {
      handleModuleRels(node, cur);
      return;
    } else if (k === 'method') {
      handleMethodRels(node, cur);
      return;
    } else if (k === 'singleton_method') {
      handleSingletonMethodRels(node, cur);
      return;
    } else if (k === 'call') {
      handleCallRels(node, cur);
    }

    walkChildren(node, cur);
  }

  function walkChildren(node: SgNode, cur: Entity | null): void {
    for (const c of node.children()) walk(c, cur);
  }

  function handleClassRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'constant');
    const cls = name ? ctx.entityMap.get(name) : null;
    if (!cls || !name) return;

    // Superclass: class Dog < Animal
    const superclass = findChild(node, 'superclass');
    if (superclass) {
      const baseName = findChildText(superclass, 'constant');
      if (baseName) addRelationByName(ctx, cls, baseName, 'extend', superclass);
    }

    const body = findChild(node, 'body_statement');
    if (body) handleBodyMembers(body, cls, name);
  }

  function handleModuleRels(node: SgNode, _parent: Entity | null): void {
    const name = findChildText(node, 'constant');
    const mod = name ? ctx.entityMap.get(name) : null;
    if (!mod || !name) return;

    const body = findChild(node, 'body_statement');
    if (body) handleBodyMembers(body, mod, name);
  }

  function handleBodyMembers(
    body: SgNode, owner: Entity, ownerName: string,
  ): void {
    for (const c of body.children()) {
      const ck = c.kind();
      if (ck === 'method' || ck === 'singleton_method') {
        const mn = findChildText(c, 'identifier');
        const me = mn ? entities.find(
          e => e.name === mn && (e.kind === 'method' || e.kind === 'function')
            && e.qualified_name.includes(`${ownerName}.`),
        ) : null;
        if (me) addRelation(ctx, owner, me, 'contain', c);
        walkChildren(c, me ?? owner);
      } else if (ck === 'call') {
        // Check for include/extend/require inside class body
        handleCallRels(c, owner);
        // Also check for attr_* field contain
        handleAttrContain(c, owner, ownerName);
      } else {
        walk(c, owner);
      }
    }
  }

  function handleAttrContain(
    node: SgNode, owner: Entity, ownerName: string,
  ): void {
    const methodName = findChildText(node, 'identifier');
    if (
      methodName === 'attr_accessor'
      || methodName === 'attr_reader'
      || methodName === 'attr_writer'
    ) {
      const argList = findChild(node, 'argument_list');
      if (argList) {
        for (const c of argList.children()) {
          if (c.kind() === 'simple_symbol') {
            const fieldName = c.text().replace(/^:/, '');
            const fe = entities.find(
              e => e.name === fieldName && e.kind === 'field'
                && e.qualified_name.includes(`${ownerName}.`),
            );
            if (fe) addRelation(ctx, owner, fe, 'contain', c);
          }
        }
      }
    }
  }

  function handleMethodRels(node: SgNode, parent: Entity | null): void {
    const name = findChildText(node, 'identifier');
    const me = name ? entities.find(
      e => e.name === name && (e.kind === 'method' || e.kind === 'function'),
    ) : null;
    walkChildren(node, me ?? parent);
  }

  function handleSingletonMethodRels(
    node: SgNode, parent: Entity | null,
  ): void {
    const name = findChildText(node, 'identifier');
    const me = name ? entities.find(
      e => e.name === name && e.kind === 'method',
    ) : null;
    walkChildren(node, me ?? parent);
  }

  function handleCallRels(node: SgNode, cur: Entity | null): void {
    const methodName = findChildText(node, 'identifier');
    if (!methodName) return;

    // require / require_relative → import
    if (methodName === 'require' || methodName === 'require_relative') {
      addImportRelation(ctx, node);
      return;
    }

    // include → mixin
    if (methodName === 'include' && cur) {
      const argList = findChild(node, 'argument_list');
      if (argList) {
        for (const c of argList.children()) {
          if (c.kind() === 'constant') {
            addRelationByName(ctx, cur, c.text(), 'mixin', c);
          }
        }
      }
      return;
    }

    // extend → mixin (Ruby's extend mixes into singleton class)
    if (methodName === 'extend' && cur) {
      const argList = findChild(node, 'argument_list');
      if (argList) {
        for (const c of argList.children()) {
          if (c.kind() === 'constant') {
            addRelationByName(ctx, cur, c.text(), 'mixin', c);
          }
        }
      }
      return;
    }

    // .new → create
    if (methodName === 'new' && cur) {
      const receiver = findChildText(node, 'constant');
      if (receiver) {
        const target = ctx.entityMap.get(receiver);
        if (target && target.kind === 'class') {
          addRelation(ctx, cur, target, 'create', node);
        } else {
          addRelationByName(ctx, cur, receiver, 'create', node);
        }
      }
      return;
    }

    // General call
    if (cur) handleCallOrCreate(ctx, cur, methodName, node);
  }

  walk(root, null);
  return ctx.relations;
}

// ─── Export ─────────────────────────────────────────────────────

export const rubyExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.rb', '.rake', '.gemspec'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'mixin',
    'use', 'contain', 'create',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
