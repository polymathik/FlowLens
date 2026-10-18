/**
 * AST node handlers for entity extraction: class, method, field,
 * interface, function, variable, type alias, enum, namespace, decorator,
 * and parameter handlers.
 *
 * Each handler extracts one entity kind from an AST node and appends
 * it to the shared entities array.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../contracts/entities.js';
import {
  type VisitorContext,
  findChild,
  findChildText,
  createEntity,
  resolveTopLevelVisibility,
  resolveClassMemberVisibility,
} from './extractor-helpers.js';

// ─── Class ───────────────────────────────────────────────────────

export function handleClassDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
  visitNode: VisitFn,
): void {
  const name = findChildText(node, 'type_identifier')
    ?? findChildText(node, 'identifier')
    ?? '<anonymous>';
  const visibility = resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'class', visibility, ctx));

  const prevInsideClass = ctx.insideClass;
  ctx.insideClass = true;
  ctx.parentNames.push(name);
  // Decorators attached to this class (`Cls.@Dec`); `@Dec export class` puts
  // them on the enclosing export_statement.
  const exportParent = node.parent();
  const decoratorHosts = exportParent?.kind() === 'export_statement' ? [exportParent, node] : [node];
  for (const host of decoratorHosts) {
    for (const child of host.children()) {
      if (child.kind() === 'decorator') handleDecorator(child, ctx, entities);
    }
  }
  const body = findChild(node, 'class_body');
  if (body) visitClassBody(body, ctx, entities, visitNode);
  ctx.parentNames.pop();
  ctx.insideClass = prevInsideClass;
}

function visitClassBody(
  body: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
  _visitNode: VisitFn,
): void {
  const pendingDecorators: SgNode[] = [];
  for (const child of body.children()) {
    const ck = child.kind();
    if (ck === 'decorator') {
      pendingDecorators.push(child);
      continue;
    }
    if (ck === 'method_definition' || ck === 'public_field_definition') {
      // Method decorators precede the method as siblings: `Cls.method.@Dec`
      const memberName = memberNameOf(child);
      ctx.parentNames.push(memberName);
      for (const dec of pendingDecorators) handleDecorator(dec, ctx, entities);
      for (const dec of child.children()) if (dec.kind() === 'decorator') handleDecorator(dec, ctx, entities);
      ctx.parentNames.pop();
      if (ck === 'method_definition') handleMethodDefinition(child, ctx, entities);
      else handleFieldDefinition(child, ctx, entities);
    }
    pendingDecorators.length = 0;
  }
}

function memberNameOf(node: SgNode): string {
  return findChildText(node, 'property_identifier')
    ?? findChildText(node, 'private_property_identifier')
    ?? '<anonymous>';
}

// ─── Interface ───────────────────────────────────────────────────

export function handleInterfaceDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(node, 'type_identifier') ?? '<anonymous>';
  const visibility = resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'interface', visibility, ctx));
}

// ─── Function Declaration ────────────────────────────────────────

export function handleFunctionDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(node, 'identifier') ?? '<anonymous>';
  const visibility = ctx.insideClass
    ? resolveClassMemberVisibility(node)
    : resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'function', visibility, ctx));
  ctx.parentNames.push(name);
  extractParameters(node, ctx, entities);
  ctx.parentNames.pop();
}

// ─── Method ──────────────────────────────────────────────────────

export function handleMethodDefinition(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = memberNameOf(node);
  const visibility = resolveClassMemberVisibility(node);
  entities.push(createEntity(node, name, 'method', visibility, ctx));

  ctx.parentNames.push(name);
  extractParameters(node, ctx, entities);
  ctx.parentNames.pop();
}

// ─── Field ───────────────────────────────────────────────────────

export function handleFieldDefinition(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(node, 'property_identifier')
    ?? findChildText(node, 'private_property_identifier')
    ?? '<anonymous>';
  const visibility = resolveClassMemberVisibility(node);
  entities.push(createEntity(node, name, 'field', visibility, ctx));
}

// ─── Variable Declaration (const/let/var) ────────────────────────

export function handleVariableDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  for (const child of node.children()) {
    if (child.kind() === 'variable_declarator') {
      handleVariableDeclarator(child, node, ctx, entities);
    }
  }
}

function handleVariableDeclarator(
  declarator: SgNode,
  declaration: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(declarator, 'identifier') ?? '<anonymous>';
  const visibility = ctx.insideClass
    ? resolveClassMemberVisibility(declaration)
    : resolveTopLevelVisibility(ctx);

  const arrowFn = findChild(declarator, 'arrow_function') ?? findChild(declarator, 'function_expression');
  if (arrowFn) {
    entities.push(createEntity(declaration, name, 'function', visibility, ctx));
    ctx.parentNames.push(name);
    extractParameters(arrowFn, ctx, entities);
    ctx.parentNames.pop();
  } else {
    entities.push(createEntity(declaration, name, 'variable', visibility, ctx));
  }
}

// ─── Type Alias ──────────────────────────────────────────────────

export function handleTypeAliasDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(node, 'type_identifier') ?? '<anonymous>';
  const visibility = resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'type', visibility, ctx));
}

// ─── Enum ────────────────────────────────────────────────────────

export function handleEnumDeclaration(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const name = findChildText(node, 'identifier') ?? '<anonymous>';
  const visibility = resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'enum', visibility, ctx));

  const body = findChild(node, 'enum_body');
  if (body) {
    ctx.parentNames.push(name);
    for (const child of body.children()) {
      const ck = child.kind();
      if (ck === 'property_identifier') {
        entities.push(createEntity(child, child.text(), 'enum_member', 'public', ctx));
      } else if (ck === 'enum_assignment') {
        const memberName = findChildText(child, 'property_identifier') ?? '<unknown>';
        entities.push(createEntity(child, memberName, 'enum_member', 'public', ctx));
      }
    }
    ctx.parentNames.pop();
  }
}

// ─── Namespace ───────────────────────────────────────────────────

export function handleNamespace(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
  visitChildren: (node: SgNode, ctx: VisitorContext, entities: Entity[]) => void,
): void {
  const name = findChildText(node, 'identifier') ?? '<anonymous>';
  const visibility = resolveTopLevelVisibility(ctx);
  entities.push(createEntity(node, name, 'namespace', visibility, ctx));

  const body = findChild(node, 'statement_block');
  if (body) {
    ctx.parentNames.push(name);
    visitChildren(body, ctx, entities);
    ctx.parentNames.pop();
  }
}

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
  entities.push(entity);
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

function extractParameters(
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

// ─── Types ───────────────────────────────────────────────────────

/** Callback type for the visitor dispatch function. */
export type VisitFn = (
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
) => void;
