/**
 * Inheritance relation extraction (TS/JS): extend, implement, mixin, override.
 *
 * Handles the TypeScript heritage shape (`class_heritage > extends_clause /
 * implements_clause`) and the JavaScript one (`class_heritage > extends expr`).
 * Parents may be local, imported, namespaced (`ns.Base`) or generic
 * (`Base<T>`); cross-file parents become pending relations for pass 2.
 * Overrides: every method of the class links to `Parent.<method>` (optional —
 * a method that overrides nothing is simply dropped in pass 2).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { ClassScope, TsRelationContext } from './ts-context.js';
import { refText } from './ts-context.js';
import { findChild } from '../extractor-helpers.js';

/** Process a class node's heritage; returns the class scope for its body. */
export function handleClassHeritage(node: SgNode, cls: Entity, ctx: TsRelationContext, methods: Entity[]): ClassScope {
  const em = ctx.emitter;
  let parentRef: string | null = null;
  const heritage = findChild(node, 'class_heritage');
  if (heritage) {
    const extendsClause = findChild(heritage, 'extends_clause');
    if (extendsClause) {
      parentRef = handleExtends(extendsClause.children(), cls, ctx);
    } else if (heritage.children().some((c) => c.kind() === 'extends')) {
      parentRef = handleExtends(heritage.children(), cls, ctx);
    }
    const implementsClause = findChild(heritage, 'implements_clause');
    if (implementsClause) {
      for (const t of implementsClause.children()) {
        const name = refText(t);
        if (name) em.link(cls, 'implement', name, t);
      }
    }
  }
  if (parentRef) {
    for (const m of methods) {
      if (m.name === 'constructor') continue;
      em.link(m, 'override', `${parentRef}.${m.name}`, node, { optional: true });
    }
  }
  return { entity: cls, parentRef };
}

/** `interface A extends B, C<T>` → an `extend` edge to every base (an interface may extend an object type alias too). */
export function handleInterfaceHeritage(node: SgNode, iface: Entity, ctx: TsRelationContext): void {
  const clause = findChild(node, 'extends_type_clause');
  if (!clause) return;
  for (const t of clause.children()) {
    const name = t.kind() === 'extends' ? null : refText(t);
    if (name) ctx.emitter.link(iface, 'extend', name, t, { kinds: ['interface', 'class', 'type'] });
  }
}

function handleExtends(children: SgNode[], cls: Entity, ctx: TsRelationContext): string | null {
  for (const child of children) {
    const k = child.kind();
    if (k === 'extends' || k === 'type_arguments') continue;
    if (k === 'call_expression') return handleMixin(child, cls, ctx);
    const name = refText(child);
    if (name) {
      ctx.emitter.link(cls, 'extend', name, child);
      return name;
    }
  }
  return null;
}

/** `class X extends Mixin(Base)` → mixin X→Mixin; members fall back to Base. */
function handleMixin(call: SgNode, cls: Entity, ctx: TsRelationContext): string | null {
  const callee = call.children()[0];
  const mixinName = callee ? refText(callee) : null;
  if (mixinName) ctx.emitter.link(cls, 'mixin', mixinName, call);
  const args = findChild(call, 'arguments');
  const base = args?.children().find((a) => refText(a) !== null);
  return base ? refText(base) : null;
}
