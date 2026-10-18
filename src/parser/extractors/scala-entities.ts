/**
 * Scala entity extraction (split from scala-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'scala';

/** Resolve Scala visibility from access modifiers. */
function scalaVis(node: SgNode): Visibility {
  for (const c of node.children()) {
    if (c.kind() === 'access_modifier') {
      const t = c.text();
      if (t.includes('private')) return 'private';
      if (t.includes('protected')) return 'protected';
    }
  }
  return 'public';
}

// ─── Entity Extraction ──────────────────────────────────────────

export function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_definition': handleClass(node, parents); break;
      case 'trait_definition': handleTrait(node, parents); break;
      case 'object_definition': handleObject(node, parents); break;
      case 'function_definition': handleFunc(node, parents, inClass); break;
      case 'function_declaration': handleFuncDecl(node, parents); break;
      case 'val_definition': handleVal(node, parents, inClass); break;
      case 'var_definition': handleVar(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClass(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    // Extract annotation as decorator
    extractAnnotations(node, parents);
    out.push(makeEntity(node, name, 'class', scalaVis(node), fp, LANG, parents));
    // Case class parameters become fields
    const classParams = findChild(node, 'class_parameters');
    if (classParams) {
      for (const c of classParams.children()) {
        if (c.kind() === 'class_parameter') {
          const pname = findChildText(c, 'identifier');
          if (pname) {
            out.push(makeEntity(c, pname, 'field', 'public', fp, LANG, [...parents, name]));
          }
        }
      }
    }
    const body = findChild(node, 'template_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleTrait(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    extractAnnotations(node, parents);
    out.push(makeEntity(node, name, 'interface', scalaVis(node), fp, LANG, parents));
    const body = findChild(node, 'template_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleObject(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    extractAnnotations(node, parents);
    out.push(makeEntity(node, name, 'class', scalaVis(node), fp, LANG, parents));
    const body = findChild(node, 'template_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleFunc(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, scalaVis(node), fp, LANG, parents));
    // Walk the function body for nested vals/vars
    const block = findChild(node, 'block');
    if (block) walk(block, parents, false);
  }

  function handleFuncDecl(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'method', scalaVis(node), fp, LANG, parents));
  }

  function handleVal(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, scalaVis(node), fp, LANG, parents));
  }

  function handleVar(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, scalaVis(node), fp, LANG, parents));
  }

  function extractAnnotations(node: SgNode, parents: string[]): void {
    for (const c of node.children()) {
      if (c.kind() === 'annotation') {
        const aname = findChildText(c, 'type_identifier')
          ?? findChildText(c, 'identifier');
        if (aname) {
          out.push(makeEntity(c, aname, 'decorator', 'public', fp, LANG, parents));
        }
      }
    }
  }

  walk(root, [], false);
  return out;
}
