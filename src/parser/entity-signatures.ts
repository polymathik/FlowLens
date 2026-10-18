/**
 * Callable members that have no body: interface method signatures and abstract
 * class methods (TypeScript).
 *
 * They become `method` entities (qualified `Iface.scan`, `Base.run`) so that
 *   - a call through a receiver typed as the interface / abstract class
 *     (`adapter.scan()`) resolves to a real entity instead of an unresolved
 *     member leaf, and
 *   - the Flow tracer can fan out from the signature to its implementations.
 * Data members stay out: only `name(...)`, `name?(...)` and `name: (…) => …`
 * (a function-typed property is called exactly like a method) count. Getters,
 * setters, index / call / construct signatures are skipped; overloads collapse
 * onto the first signature (entity dedupe). Parameters are not extracted.
 * `annotations.signature` = `interface` | `abstract` tells them from implemented methods.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../contracts/entities.js';
import { createEntity, findChildText, type VisitorContext } from './extractor-helpers.js';

function isAccessor(node: SgNode): boolean {
  return node.children().some((c) => {
    const k = String(c.kind());
    return (k === 'get' || k === 'set') && c.text() === k;
  });
}

function memberName(node: SgNode): string | null {
  return findChildText(node, 'property_identifier');
}

/** `scan: (opts: X) => Promise<Y>` — a property whose declared type is a function type. */
function hasFunctionType(node: SgNode): boolean {
  const annotation = node.children().find((c) => c.kind() === 'type_annotation');
  return !!annotation && annotation.children().some((c) => c.kind() === 'function_type');
}

/** Method entities for the members of an `interface_body` (caller has pushed the interface name). */
export function handleInterfaceBody(body: SgNode, ctx: VisitorContext, entities: Entity[]): void {
  for (const member of body.children()) {
    const kind = String(member.kind());
    const callable = (kind === 'method_signature' && !isAccessor(member)) || (kind === 'property_signature' && hasFunctionType(member));
    const name = callable ? memberName(member) : null;
    if (!name) continue;
    const entity = createEntity(member, name, 'method', 'public', ctx);
    entity.annotations = { signature: 'interface' };
    entities.push(entity);
  }
}

/** Method entity for `abstract name(...): T;` in a class body (caller has pushed the class name). */
export function handleAbstractMethod(node: SgNode, ctx: VisitorContext, entities: Entity[]): void {
  const name = memberName(node);
  if (!name || isAccessor(node)) return;
  const entity = createEntity(node, name, 'method', abstractVisibility(node), ctx);
  entity.annotations = { signature: 'abstract' };
  entities.push(entity);
}

function abstractVisibility(node: SgNode): 'public' | 'private' | 'protected' {
  for (const c of node.children()) {
    if (c.kind() === 'accessibility_modifier') {
      const text = c.text();
      if (text === 'private' || text === 'protected') return text;
    }
  }
  return 'public';
}
