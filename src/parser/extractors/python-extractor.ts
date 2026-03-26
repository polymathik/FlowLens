/**
 * Python language extractor.
 *
 * Extracts entities (classes, functions, methods, fields, variables, decorators)
 * and relations (import, call, extend, implement, use, contain, create, decorate)
 * from Python ASTs parsed by tree-sitter.
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

const LANG = 'python';

// ─── Decorator Name Helper ──────────────────────────────────────

function extractDecoratorName(decNode: SgNode): string | null {
  for (const child of decNode.children()) {
    if (child.kind() === 'identifier') return child.text();
    if (child.kind() === 'call') {
      const id = findChild(child, 'identifier');
      if (id) return id.text();
    }
    if (child.kind() === 'attribute') return child.text();
  }
  return null;
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_definition': {
        const name = findChildText(node, 'identifier');
        if (!name) return;
        out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
        const body = findChild(node, 'block');
        if (body) walk(body, [...parents, name], true);
        break;
      }
      case 'function_definition': {
        const name = findChildText(node, 'identifier');
        if (!name) return;
        const kind: EntityKind = inClass ? 'method' : 'function';
        const vis: Visibility = name.startsWith('__') && !name.endsWith('__')
          ? 'private' : name.startsWith('_') ? 'protected' : 'public';
        out.push(makeEntity(node, name, kind, vis, fp, LANG, parents));
        break;
      }
      case 'decorated_definition': {
        const dec = findChild(node, 'decorator');
        if (dec) {
          const dn = extractDecoratorName(dec);
          if (dn) out.push(makeEntity(dec, dn, 'decorator', 'public', fp, LANG, parents));
        }
        for (const c of node.children()) {
          if (c.kind() !== 'decorator') visit(c, parents, inClass);
        }
        break;
      }
      case 'expression_statement': {
        const assign = findChild(node, 'assignment');
        if (!assign) return;
        const id = findChild(assign, 'identifier');
        if (!id) return;
        const name = id.text();
        const kind: EntityKind = inClass ? 'field' : 'variable';
        const vis: Visibility = name.startsWith('__') && !name.endsWith('__')
          ? 'private' : name.startsWith('_') ? 'protected' : 'public';
        out.push(makeEntity(assign, name, kind, vis, fp, LANG, parents));
        break;
      }
      default:
        walk(node, parents, inClass);
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
    if (k === 'import_statement' || k === 'import_from_statement') {
      addImportRelation(ctx, node);
    } else if (k === 'class_definition') {
      handleClass(ctx, node, cur);
      return;
    } else if (k === 'function_definition') {
      const name = findChildText(node, 'identifier');
      const fn = name ? ctx.entityMap.get(name) : null;
      for (const c of node.children()) walk(c, fn ?? cur);
      return;
    } else if (k === 'decorated_definition') {
      handleDecorate(ctx, node, entities);
    } else if (k === 'call') {
      const fn = findChild(node, 'identifier');
      if (fn) handleCallOrCreate(ctx, cur, fn.text(), node);
    }
    for (const c of node.children()) walk(c, cur);
  }

  walk(root, null);
  return ctx.relations;
}

function handleClass(ctx: RelationContext, node: SgNode, parent: Entity | null): void {
  const name = findChildText(node, 'identifier');
  const cls = name ? ctx.entityMap.get(name) : null;
  if (!cls) return;
  if (parent) addRelation(ctx, parent, cls, 'contain', node);

  const argList = findChild(node, 'argument_list');
  if (argList) {
    for (const c of argList.children()) {
      if (c.kind() === 'identifier') {
        const bn = c.text();
        addRelationByName(ctx, cls, bn, bn === 'ABC' ? 'implement' : 'extend', node);
      }
    }
  }

  const body = findChild(node, 'block');
  if (!body) return;
  for (const c of body.children()) {
    if (c.kind() === 'function_definition') {
      const mn = findChildText(c, 'identifier');
      const me = mn ? ctx.entities.find(
        e => e.name === mn && e.qualified_name.includes(`${name}.`),
      ) : null;
      if (me) addRelation(ctx, cls, me, 'contain', c);
      walkBody(ctx, c, me ?? cls);
    } else if (c.kind() === 'decorated_definition') {
      handleDecorate(ctx, c, ctx.entities);
      // Also walk the function inside for calls/creates
      for (const inner of c.children()) {
        if (inner.kind() === 'function_definition') {
          const mn = findChildText(inner, 'identifier');
          const me = mn ? ctx.entities.find(
            e => e.name === mn && e.qualified_name.includes(`${name}.`),
          ) : null;
          if (me) addRelation(ctx, cls, me, 'contain', inner);
          walkBody(ctx, inner, me ?? cls);
        }
      }
    } else if (c.kind() === 'expression_statement') {
      const assign = findChild(c, 'assignment');
      if (assign) {
        const fn = findChildText(assign, 'identifier');
        const fe = fn ? ctx.entities.find(
          e => e.name === fn && e.qualified_name.includes(`${name}.`),
        ) : null;
        if (fe) addRelation(ctx, cls, fe, 'contain', c);
      }
      walkBody(ctx, c, cls);
    } else {
      walkBody(ctx, c, cls);
    }
  }
}

function walkBody(ctx: RelationContext, node: SgNode, cur: Entity | null): void {
  if (node.kind() === 'call') {
    const fn = findChild(node, 'identifier');
    if (fn) handleCallOrCreate(ctx, cur, fn.text(), node);
  }
  for (const c of node.children()) walkBody(ctx, c, cur);
}

function handleDecorate(ctx: RelationContext, node: SgNode, entities: Entity[]): void {
  const dec = findChild(node, 'decorator');
  if (!dec) return;
  const dn = extractDecoratorName(dec);
  const de = dn ? entities.find(e => e.kind === 'decorator' && e.name === dn) : null;
  let target: Entity | null = null;
  for (const c of node.children()) {
    if (c.kind() === 'function_definition' || c.kind() === 'class_definition') {
      const tn = findChildText(c, 'identifier');
      target = tn ? ctx.entityMap.get(tn) ?? null : null;
      break;
    }
  }
  if (de && target) addRelation(ctx, de, target, 'decorate', dec);
}

// ─── Export ─────────────────────────────────────────────────────

export const pythonExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.py'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement',
    'use', 'contain', 'create', 'decorate',
  ] as RelationType[],
  extractEntities,
  extractRelations,
};
