/**
 * TS/JS relation extraction — one iterative AST walk carrying a lexical
 * scope frame, dispatching to the focused handler modules.
 *
 * Output mixes direct relations (same-file targets, import edges) and
 * pending relations (`to: ''`, `target_name`) for pass-2 resolution.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { walkWithContext } from '../ast-walk.js';
import { extractTsSymbols } from '../symbols/ts-symbols.js';
import {
  type ScopeFrame, type TsRelationContext,
  createTsContext, rootFrame, declName, methodName, assignedName,
  CLASS_KINDS, FUNCTION_KINDS, ANON_FUNCTION_KINDS,
} from './ts-context.js';
import { handleImportStatement, handleReExport, handleRequireOrDynamicImport } from './import-relations.js';
import { handleCall } from './call-relations.js';
import { handleClassHeritage } from './inheritance-relations.js';
import { handleFunctionTypes } from './type-relations.js';
import { containRelations, handleNew, handleIdentifierUse } from './data-relations.js';
import { handleDecorator } from './decorate-relations.js';
import { handleJsxElement, handleReferenceIdentifier, handleThisReference } from './reference-relations.js';
import { aggregateRelations } from '../../graph/aggregate.js';
import { boundNames, buildFunctionScope, declareDeclarator } from './scope-build.js';

/**
 * Extract all relations from a parsed TS/JS AST.
 *
 * @param symbols - the file's symbols (computed here when omitted)
 * @param rootEntity - owner of top-level statements (single-file components); default none
 */
export function extractRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  rootDir: string,
  symbols?: FileSymbols,
  rootEntity?: Entity,
): Relation[] {
  const sym = symbols ?? extractTsSymbols(root, filePath, rootDir, entities[0]?.language ?? 'typescript');
  const ctx = createTsContext(root, filePath, rootDir, entities, sym, rootEntity);
  const methodsByClass = groupMethods(entities, filePath);

  walkWithContext<ScopeFrame>(root, rootFrame(ctx.rootOwner, ctx.moduleScope), (node, frame) => visit(node, frame, ctx, methodsByClass));

  return aggregateRelations([...containRelations(entities, filePath), ...ctx.emitter.relations]);
}

function visit(
  node: SgNode, frame: ScopeFrame, ctx: TsRelationContext, methodsByClass: Map<string, Entity[]>,
): ScopeFrame | null {
  const kind = String(node.kind());
  switch (kind) {
    case 'import_statement':
      handleImportStatement(node, ctx);
      return null;
    case 'export_statement':
      handleReExport(node, ctx);
      return frame;
    case 'call_expression':
      if (!handleRequireOrDynamicImport(node, ctx)) handleCall(node, frame, ctx);
      return frame;
    case 'new_expression':
      handleNew(node, frame, ctx);
      return frame;
    case 'variable_declarator':
      if (!ctx.moduleDeclared.has(node.range().start.index)) declareDeclarator(node, frame.scope);
      return frame;
    case 'for_in_statement':
    case 'catch_clause':
      declareLoopOrCatchNames(node, frame);
      return frame;
    case 'throw_statement':
      return { ...frame, inThrow: true };
    case 'decorator':
      handleDecorator(node, frame, ctx);
      return frame;
    case 'identifier':
      handleIdentifierUse(node, frame, ctx);
      return null;
    case 'shorthand_property_identifier':
      handleReferenceIdentifier(node, frame, ctx);
      return null;
    case 'member_expression':
      handleThisReference(node, frame, ctx);
      return frame;
    case 'jsx_opening_element':
    case 'jsx_self_closing_element':
      handleJsxElement(node, frame, ctx);
      return frame;
    case 'internal_module': {
      const name = declName(node);
      return name ? { ...frame, path: [...frame.path, name] } : frame;
    }
    case 'method_definition': {
      const name = methodName(node);
      if (!name) return frame;
      return enterFunction(node, [...frame.path, name], 'method', frame, ctx);
    }
  }
  if (CLASS_KINDS.has(kind)) return enterClass(node, frame, ctx, methodsByClass);
  if (FUNCTION_KINDS.has(kind)) {
    const name = declName(node);
    if (!name) return enterAnonymous(node, frame, ctx);
    if (frame.scope.parent) frame.scope.declare(name, null); // a nested function shadows outer names
    return enterFunction(node, [...frame.path, name], 'function', frame, ctx);
  }
  if (ANON_FUNCTION_KINDS.has(kind)) {
    const name = assignedName(node);
    if (!name) return enterAnonymous(node, frame, ctx);
    return enterFunction(node, [...frame.path, name], 'function', frame, ctx);
  }
  return frame;
}

/** A callback / default-exported function: keeps the enclosing owner, gets its own parameter scope. */
function enterAnonymous(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): ScopeFrame {
  return { ...frame, inThrow: false, scope: buildFunctionScope(node, frame.scope, ctx.types) };
}

/** `for (const k of xs)` / `catch (err)`: locals of unknown type that shadow outer names. */
function declareLoopOrCatchNames(node: SgNode, frame: ScopeFrame): void {
  const target = node.children().find((c) => ['identifier', 'object_pattern', 'array_pattern'].includes(String(c.kind())));
  if (target) for (const name of boundNames(target)) frame.scope.declare(name, null);
}

function enterFunction(
  node: SgNode, path: string[], kind: 'function' | 'method', frame: ScopeFrame, ctx: TsRelationContext,
): ScopeFrame {
  const entity = ctx.emitter.entityAt(path, [kind]);
  if (entity) handleFunctionTypes(node, entity, ctx);
  return {
    path, entity: entity ?? frame.entity, cls: frame.cls, inThrow: false,
    scope: buildFunctionScope(node, frame.scope, ctx.types),
  };
}

function enterClass(
  node: SgNode, frame: ScopeFrame, ctx: TsRelationContext, methodsByClass: Map<string, Entity[]>,
): ScopeFrame {
  const name = declName(node) ?? (node.kind() === 'class' ? assignedName(node) : null);
  if (!name) return frame;
  const path = [...frame.path, name];
  const entity = ctx.emitter.entityAt(path, ['class']);
  if (!entity) return { ...frame, path };
  const cls = handleClassHeritage(node, entity, ctx, methodsByClass.get(entity.qualified_name) ?? []);
  return { path, entity, cls, inThrow: false, scope: frame.scope };
}

function groupMethods(entities: Entity[], filePath: string): Map<string, Entity[]> {
  const map = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.kind !== 'method' || e.file !== filePath) continue;
    const owner = e.qualified_name.slice(0, e.qualified_name.lastIndexOf('.'));
    const list = map.get(owner);
    if (list) list.push(e); else map.set(owner, [e]);
  }
  return map;
}
