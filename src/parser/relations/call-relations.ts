/**
 * Call relation extraction (TS/JS).
 *
 * - `foo()`          → local function, or pending through an import binding.
 * - `this.m()`       → method of the *enclosing* class (by qualified name),
 *                      else the parent class's member (optional, pass 2).
 * - `super.m()`      → parent class member (optional).
 * - `ns.f()`/`A.b()` → namespace import member / static member; member
 *                      calls through non-namespace bindings are optional
 *                      because the receiver may be an instance.
 * Calls whose receiver is a local variable or an expression are dropped:
 * without type information their target is unknown.
 */
import type { SgNode } from '@ast-grep/napi';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { refText } from './ts-context.js';

export function handleCall(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  const from = frame.entity;
  if (!from) return;
  const callee = node.children()[0];
  if (!callee) return;
  const em = ctx.emitter;

  if (callee.kind() === 'identifier') {
    em.link(from, 'call', callee.text(), node);
    return;
  }
  if (callee.kind() !== 'member_expression') return;

  const parts = callee.children();
  const object = parts[0];
  const property = parts[parts.length - 1];
  if (!object || !property || property.kind() !== 'property_identifier') return;
  const method = property.text();

  if (object.kind() === 'this') {
    if (!frame.cls) return;
    const own = em.member(frame.cls.entity, method, ['method']);
    if (own) em.direct(from, own, 'call', node);
    else if (frame.cls.parentRef) em.link(from, 'call', `${frame.cls.parentRef}.${method}`, node, { optional: true });
    return;
  }
  if (object.kind() === 'super') {
    if (frame.cls?.parentRef) em.link(from, 'call', `${frame.cls.parentRef}.${method}`, node, { optional: true });
    return;
  }

  const receiver = refText(object);
  if (!receiver) return;
  const head = receiver.split('.')[0];
  const binding = em.binding(head);
  const optional = binding ? binding.imported !== '*' : true;
  em.link(from, 'call', `${receiver}.${method}`, node, { optional });
}
