/**
 * Functions defined inside a module-level object literal:
 *
 *   export const api = { workspace: () => get('/w'), save(id) { … } };
 *
 * The object is the only way to reach these functions (`api.workspace()`), and
 * code like this holds a large part of small apps (service objects, handler
 * maps, per-language extractors). Each function member of a module-level
 * `const` / `let` / `var` object becomes a `method` entity `api.workspace`
 * (container: the variable), so
 *   - calls through the variable resolve (`api.workspace()` in any file),
 *   - calls made inside the function belong to it, not to the file.
 * Nested objects, computed or string keys, getters / setters, spreads and
 * non-function values are left alone; objects built by calls (`create({…})`)
 * are not module-level literals and are not touched.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, Visibility } from '../contracts/entities.js';
import { createEntity, type VisitorContext } from './extractor-helpers.js';
import { extractParameters } from './entity-members.js';

const WRAPPERS = new Set(['as_expression', 'satisfies_expression', 'parenthesized_expression']);
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

/** The object literal a declarator is initialised with (through `as T` / `satisfies T` / parentheses). */
export function objectLiteralOf(declarator: SgNode): SgNode | null {
  const kids = declarator.children();
  if (kids.length < 3 || kids[0].kind() !== 'identifier') return null;
  let value: SgNode | undefined = kids[kids.length - 1];
  for (let depth = 0; value && WRAPPERS.has(String(value.kind())) && depth < 4; depth++) {
    value = value.children().find((c) => !['(', ')', 'as', 'satisfies'].includes(String(c.kind())));
  }
  return value && value.kind() === 'object' ? value : null;
}

export interface ObjectFunctionMember {
  name: string;
  /** The `pair` / `method_definition` node (entity location). */
  node: SgNode;
  /** The function node that has the parameters and the body. */
  fn: SgNode;
}

export function objectFunctionMembers(object: SgNode): ObjectFunctionMember[] {
  const out: ObjectFunctionMember[] = [];
  for (const m of object.children()) {
    const kind = String(m.kind());
    if (kind === 'pair') {
      const kids = m.children();
      const value = kids[kids.length - 1];
      if (kids[0].kind() === 'property_identifier' && value && FUNCTION_VALUES.has(String(value.kind()))) {
        out.push({ name: kids[0].text(), node: m, fn: value });
      }
    } else if (kind === 'method_definition') {
      const kids = m.children();
      const accessor = kids.some((c) => c.kind() === 'get' || c.kind() === 'set');
      const name = kids.find((c) => c.kind() === 'property_identifier');
      if (!accessor && name) out.push({ name: name.text(), node: m, fn: m });
    }
  }
  return out;
}

/** `method` entities (with parameters) for the function members of a module-level object literal. */
export function handleObjectMembers(
  declarator: SgNode, owner: string, visibility: Visibility, ctx: VisitorContext, entities: Entity[],
): void {
  const object = objectLiteralOf(declarator);
  if (!object) return;
  ctx.parentNames.push(owner);
  for (const member of objectFunctionMembers(object)) {
    const entity = createEntity(member.node, member.name, 'method', visibility, ctx);
    entity.annotations = { member: 'object' };
    entities.push(entity);
    ctx.parentNames.push(member.name);
    extractParameters(member.fn, ctx, entities);
    ctx.parentNames.pop();
  }
  ctx.parentNames.pop();
}
