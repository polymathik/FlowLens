/**
 * Member calls `recv.method()` through typed receivers (TS/JS).
 *
 * The receiver's *declared* type is read from syntax only — a parameter or
 * variable annotation, `const x = new Foo()`, `x as Foo`, a typed class field
 * (`this.dep`), a constructor parameter property, a property of a same-file
 * interface (`deps.discovery`) — and the call becomes `Type.method`, resolved
 * like any other qualified reference (same file directly, imports in pass 2,
 * inherited members through the class's parents). Anything that is not a
 * declared type stays unrecorded: a wrong edge is worse than a missing one.
 *
 * A receiver that is a *local of unknown type* (untyped parameter, call
 * result, destructuring …) records nothing and also shadows outer names, so a
 * parameter called `api` never links to an imported `api`.
 */
import type { SgNode } from '@ast-grep/napi';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { ownerOptions } from './ts-context.js';
import { expressionTypeName } from './type-names.js';

/** Confidence of an edge whose target was found through a declared receiver type. */
export const MEMBER_CALL_CONFIDENCE = 0.9;

const MEMBER_KINDS = ['method', 'field'] as const;

/**
 * Methods every array / string / Map / Promise / event emitter has. They are
 * never worth a dashed "unresolved" leaf; a typed receiver still resolves them
 * when a project class really defines one.
 */
const BUILTIN_MEMBERS = new Set([
  'map', 'filter', 'forEach', 'reduce', 'reduceRight', 'find', 'findIndex', 'findLast', 'some', 'every', 'includes',
  'indexOf', 'lastIndexOf', 'join', 'slice', 'splice', 'concat', 'push', 'pop', 'shift', 'unshift', 'sort', 'reverse',
  'flat', 'flatMap', 'fill', 'keys', 'values', 'entries', 'get', 'set', 'has', 'add', 'delete', 'clear', 'then',
  'catch', 'finally', 'toString', 'toJSON', 'valueOf', 'trim', 'split', 'replace', 'replaceAll', 'match', 'startsWith',
  'endsWith', 'padStart', 'padEnd', 'toLowerCase', 'toUpperCase', 'charAt', 'substring', 'at', 'call', 'apply', 'bind',
  'next', 'on', 'once', 'off', 'emit', 'hasOwnProperty', 'toISOString', 'getTime', 'toFixed', 'test', 'exec',
]);

export function isBuiltinMember(method: string): boolean {
  return BUILTIN_MEMBERS.has(method);
}

/** Declared type name of an expression, or null when it is not knowable from syntax. */
export function typeOfExpression(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): string | null {
  switch (String(node.kind())) {
    case 'identifier':
      return frame.scope.lookup(node.text())?.binding.type ?? null;
    case 'member_expression': {
      const kids = node.children();
      const object = kids[0];
      const prop = kids[kids.length - 1];
      if (!object || !prop || (prop.kind() !== 'property_identifier' && prop.kind() !== 'private_property_identifier')) return null;
      const owner = object.kind() === 'this'
        ? frame.cls?.entity.name ?? null
        : typeOfExpression(object, frame, ctx);
      return owner ? ctx.types.propertyTypes(owner)?.get(prop.text()) ?? null : null;
    }
    case 'parenthesized_expression':
    case 'non_null_expression': {
      const inner = node.children().find((c) => !['(', ')', '!'].includes(String(c.kind())));
      return inner ? typeOfExpression(inner, frame, ctx) : null;
    }
    default:
      return expressionTypeName(node);
  }
}

/** A receiver that is a local of unknown type (function-level), which must not fall back to outer names. */
function isOpaqueLocal(object: SgNode, frame: ScopeFrame): boolean {
  if (object.kind() !== 'identifier') return false;
  const hit = frame.scope.lookup(object.text());
  return !!hit && hit.binding.type === null && !hit.moduleLevel;
}

/**
 * Handle `object.method()`. Returns true when the call was fully handled here
 * (an edge was recorded, or the receiver is a local of unknown type), false to
 * let the legacy `Name.member` logic run (imports, namespaces, statics).
 */
export function handleTypedMemberCall(
  object: SgNode, method: string, node: SgNode, frame: ScopeFrame, ctx: TsRelationContext,
): boolean {
  const from = frame.entity;
  if (!from) return true;
  const type = typeOfExpression(object, frame, ctx);
  if (!type) return isOpaqueLocal(object, frame);

  const em = ctx.emitter;
  const head = type.split('.')[0];
  if (!em.isImported(head) && !em.isLocal(head)) return true; // builtin, type parameter, global
  const binding = em.binding(head);
  const projectBound = !binding || (!binding.external && !!binding.source_file);
  em.link(from, 'call', `${type}.${method}`, node, {
    optional: isBuiltinMember(method) || !projectBound,
    inherited: true,
    confidence: MEMBER_CALL_CONFIDENCE,
    kinds: [...MEMBER_KINDS],
    meta: { receiver: receiverText(object), ...ownerOptions(frame, ctx).meta },
  });
  return true;
}

export function receiverText(object: SgNode): string {
  const text = object.text().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
