/**
 * Ruby entity extraction (split from ruby-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'ruby';

/** Resolve Ruby visibility — default is public. */
function rubyVis(name: string): Visibility {
  return name.startsWith('_') ? 'private' : 'public';
}

// ─── Entity Extraction ──────────────────────────────────────────

export function extractEntities(root: SgNode, fp: string): Entity[] {
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
