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
 * `recv.m()` with a receiver whose declared type is knowable from syntax is
 * resolved as `Type.m` (member-calls.ts). Calls whose receiver is a local of
 * unknown type or an arbitrary expression are dropped: a wrong edge is worse
 * than a missing one.
 */
import type { SgNode } from '@ast-grep/napi';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { ownerOptions, refText } from './ts-context.js';
import { handleTypedMemberCall, isBuiltinMember } from './member-calls.js';

const CODE_FILE = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;

function isProjectCode(file: string | null): boolean {
  return !!file && CODE_FILE.test(file);
}

export function handleCall(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  const from = frame.entity;
  if (!from) return;
  const callee = node.children()[0];
  if (!callee) return;
  const em = ctx.emitter;
  const owner = ownerOptions(frame, ctx);

  if (callee.kind() === 'identifier') {
    em.link(from, 'call', callee.text(), node, owner);
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
    if (own) em.direct(from, own, 'call', node, owner);
    else if (frame.cls.parentRef) em.link(from, 'call', `${frame.cls.parentRef}.${method}`, node, { optional: true, ...owner });
    return;
  }
  if (object.kind() === 'super') {
    if (frame.cls?.parentRef) em.link(from, 'call', `${frame.cls.parentRef}.${method}`, node, { optional: true, ...owner });
    return;
  }

  if (handleTypedMemberCall(object, method, node, frame, ctx)) return;

  const receiver = refText(object);
  if (!receiver) return;
  const head = receiver.split('.')[0];
  const binding = em.binding(head);
  if (!binding || binding.imported === '*') {
    em.link(from, 'call', `${receiver}.${method}`, node, { optional: !binding, ...owner });
    return;
  }
  // `api.workspace()` on a project import that is not a namespace: the receiver may be an
  // instance, an object literal or a class. Optional (dropped when nothing matches) unless it
  // is a plain `name.method` on project code, where a miss is a real "could not resolve".
  const strict = !receiver.includes('.') && !isBuiltinMember(method) && isProjectCode(binding.source_file);
  em.link(from, 'call', `${receiver}.${method}`, node, {
    optional: !strict, meta: { receiver, ...owner.meta },
  });
}
