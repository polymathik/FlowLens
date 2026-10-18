/**
 * TS entity handlers for decorators and parameters (split from
 * entity-handlers.ts). Decorators are scoped under the decorated declaration
 * (`Cls.method.@Dec`); parameters under their function (`fn.param`).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../contracts/entities.js';
import { type VisitorContext, findChild, createEntity } from './extractor-helpers.js';

// ─── Decorator ───────────────────────────────────────────────────

export function handleDecorator(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = extractDecoratorName(node);
  // Scoped under the decorated declaration (caller pushes its name): `Cls.method.@Dec`
  const entity = createEntity(node, `@${name}`, 'decorator', 'public', ctx);
  entity.name = name;
  const arg = firstStringArgument(node);
  if (arg !== null) entity.annotations = { arg };
  entities.push(entity);
}

/** `@Get(':id')` → `:id` (the first string literal argument, as written), or null. */
function firstStringArgument(decorator: SgNode): string | null {
  const call = findChild(decorator, 'call_expression');
  const args = call ? findChild(call, 'arguments') : null;
  const first = args?.children().find((c) => c.kind() !== '(');
  if (!first || first.kind() !== 'string') return null;
  const text = first.text().slice(1, -1);
  return text.length <= 120 ? text : null;
}

function extractDecoratorName(node: SgNode): string {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
    if (child.kind() === 'call_expression') {
      const id = findChild(child, 'identifier');
      if (id) return id.text();
      const memberExpr = findChild(child, 'member_expression');
      if (memberExpr) return memberExpr.text();
    }
    if (child.kind() === 'member_expression') return child.text();
  }
  return '<unknown>';
}

// ─── Parameters ──────────────────────────────────────────────────

export function extractParameters(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const params = findChild(node, 'formal_parameters');
  if (!params) return;

  for (const child of params.children()) {
    const ck = child.kind();
    if (ck === 'required_parameter' || ck === 'optional_parameter') {
      const name = extractParameterName(child);
      if (name) {
        entities.push(createEntity(child, name, 'parameter', 'public', ctx));
      }
    } else if (ck === 'identifier') {
      entities.push(createEntity(child, child.text(), 'parameter', 'public', ctx));
    }
  }
}

function extractParameterName(param: SgNode): string | null {
  const restPattern = findChild(param, 'rest_pattern');
  if (restPattern) {
    const id = findChild(restPattern, 'identifier');
    return id ? id.text() : null;
  }
  const id = findChild(param, 'identifier');
  return id ? id.text() : null;
}

