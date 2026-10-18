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
import { handleDecorator, extractParameters } from './entity-members.js';
import { declaratorTypeName } from './relations/type-names.js';
import { handleAbstractMethod, handleInterfaceBody } from './entity-signatures.js';
import { baseClassText, interfaceBaseText } from './entity-heritage.js';
import { handleObjectMembers } from './object-literal.js';

export { handleDecorator } from './entity-members.js';

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
  const classEntity = createEntity(node, name, 'class', visibility, ctx);
  // Remember that a base class exists even when it is external (`extends EventEmitter`): pass 2 must not
  // report a member missing from such a class as unresolved (it may be inherited from outside the project).
  const base = baseClassText(node);
  if (base) classEntity.annotations = { extends: base };
  entities.push(classEntity);

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
    if (ck === 'abstract_method_signature') {
      ctx.parentNames.push(memberNameOf(child));
      for (const dec of pendingDecorators) handleDecorator(dec, ctx, entities);
      ctx.parentNames.pop();
      handleAbstractMethod(child, ctx, entities);
    } else if (ck === 'method_definition' || ck === 'public_field_definition') {
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
  const iface = createEntity(node, name, 'interface', visibility, ctx);
  // Remember a base interface even when it is external (`extends EventEmitter`): pass 2 must not report
  // a member missing from such an interface as unresolved (it may be inherited from outside the project).
  const base = interfaceBaseText(node);
  if (base) iface.annotations = { extends: base };
  entities.push(iface);

  const body = findChild(node, 'interface_body');
  if (body) {
    ctx.parentNames.push(name);
    handleInterfaceBody(body, ctx, entities);
    ctx.parentNames.pop();
  }
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
    const entity = createEntity(declaration, name, 'variable', visibility, ctx);
    // Declared class of an instance (`const store = new Store()`, `: Store`): lets pass 2 resolve
    // `store.get()` in files that import `store` (see ProjectSymbolTable.typedMember).
    const typeRef = ctx.parentNames.length === 0 ? declaratorTypeName(declarator) : null;
    if (typeRef) entity.annotations = { type_ref: typeRef };
    entities.push(entity);
    if (ctx.parentNames.length === 0 && !ctx.insideClass) handleObjectMembers(declarator, name, visibility, ctx, entities);
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

// ─── Types ───────────────────────────────────────────────────────

/** Callback type for the visitor dispatch function. */
export type VisitFn = (
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
) => void;
