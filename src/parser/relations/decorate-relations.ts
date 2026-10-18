/**
 * Decorate relation extraction (TS): `@Dec` on classes, methods and fields.
 *
 * Source: the decorator entity created at the decorator's position (its
 * qualified name is scoped under the decorated target, so `@Get()` on two
 * methods yields two distinct entities). Target: the decorated entity,
 * found by qualified name — never by bare name.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { CLASS_KINDS, declName, methodName } from './ts-context.js';

export function handleDecorator(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  const r = node.range();
  const decorator = ctx.decoratorsAt.get(`${r.start.line + 1}:${r.start.column + 1}`);
  if (!decorator) return;
  const target = decoratedEntity(node, frame, ctx);
  if (target) ctx.emitter.direct(decorator, target, 'decorate', node);
}

function decoratedEntity(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): Entity | undefined {
  const parent = node.parent();
  if (!parent) return undefined;
  const pk = String(parent.kind());
  if (CLASS_KINDS.has(pk)) return frame.cls?.entity;
  if (pk === 'export_statement') {
    // `@Dec export class X {}` — decorator hangs off the export statement
    const cls = parent.children().find((c) => CLASS_KINDS.has(String(c.kind())));
    const name = cls ? declName(cls) : null;
    return name ? ctx.emitter.entityAt([...frame.path, name], ['class']) : undefined;
  }
  if (!frame.cls) return undefined;
  if (pk === 'public_field_definition') {
    const name = methodName(parent);
    return name ? ctx.emitter.member(frame.cls.entity, name, ['field']) : undefined;
  }
  if (pk === 'method_definition') {
    const name = methodName(parent);
    return name ? ctx.emitter.member(frame.cls.entity, name, ['method']) : undefined;
  }
  if (pk === 'class_body') {
    let sib = node.next();
    while (sib && sib.kind() === 'decorator') sib = sib.next();
    if (!sib) return undefined;
    const name = methodName(sib);
    if (!name) return undefined;
    if (sib.kind() === 'method_definition') return ctx.emitter.member(frame.cls.entity, name, ['method']);
    if (sib.kind() === 'public_field_definition') return ctx.emitter.member(frame.cls.entity, name, ['field']);
  }
  return undefined;
}
