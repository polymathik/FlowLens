/**
 * Ruby relation extraction (split from ruby-extractor.ts in Phase 12;
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
