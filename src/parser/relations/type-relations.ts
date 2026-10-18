/**
 * Type relation extraction (TS): parameter and return type references.
 *
 * Every type name in a parameter / return annotation (`User`, `ns.User`,
 * `Promise<User>`, `User[]`) is linked from the function/method entity;
 * same-file targets are direct, imported ones pending for pass 2, builtins
 * and unbound names (`Promise`, type parameters) are dropped.
 * `throw new X()` is handled by data-relations (new_expression in a throw).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { TsRelationContext } from './ts-context.js';
import { findChild } from '../extractor-helpers.js';
import { walkNodes } from '../ast-walk.js';

export function handleFunctionTypes(node: SgNode, fn: Entity, ctx: TsRelationContext): void {
  const params = findChild(node, 'formal_parameters');
  if (params) {
    for (const param of params.children()) {
      const pk = param.kind();
      if (pk !== 'required_parameter' && pk !== 'optional_parameter') continue;
      const annotation = findChild(param, 'type_annotation');
      if (annotation) linkTypes(annotation, fn, 'parameter', param, ctx);
    }
  }
  const ret = findReturnTypeAnnotation(node);
  if (ret) linkTypes(ret, fn, 'return', ret, ctx);
}

function linkTypes(
  annotation: SgNode, fn: Entity, type: 'parameter' | 'return', at: SgNode, ctx: TsRelationContext,
): void {
  const seen = new Set<string>();
  for (const name of typeNames(annotation)) {
    if (seen.has(name)) continue;
    seen.add(name);
    ctx.emitter.link(fn, type, name, at);
  }
}

/** Type names referenced in an annotation (`ns.User` kept whole). */
export function typeNames(annotation: SgNode): string[] {
  const names: string[] = [];
  walkNodes(annotation, (n) => {
    const k = n.kind();
    if (k === 'nested_type_identifier') {
      names.push(n.text());
      return false;
    }
    if (k === 'type_identifier') names.push(n.text());
    return true;
  });
  return names;
}

function findReturnTypeAnnotation(node: SgNode): SgNode | null {
  let seenParams = false;
  for (const child of node.children()) {
    const k = child.kind();
    if (k === 'formal_parameters') { seenParams = true; continue; }
    if (seenParams && k === 'type_annotation') return child;
    if (k === 'statement_block' || k === '{') break;
  }
  return null;
}
