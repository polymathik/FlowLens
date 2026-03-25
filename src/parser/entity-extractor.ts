/**
 * Deep entity extraction for TypeScript/JavaScript ASTs.
 *
 * Walks the tree recursively, dispatching to specialized handlers for
 * each of the 14 entity kinds. The `file` and `module` entities are
 * NOT created here — they are handled by the caller and indexer.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../contracts/entities.js';
import { type VisitorContext } from './extractor-helpers.js';
import {
  handleClassDeclaration,
  handleInterfaceDeclaration,
  handleFunctionDeclaration,
  handleVariableDeclaration,
  handleTypeAliasDeclaration,
  handleEnumDeclaration,
  handleNamespace,
  handleDecorator,
} from './entity-handlers.js';

/**
 * Extract all entities from a parsed TypeScript/JavaScript AST.
 */
export function extractEntities(
  root: SgNode,
  filePath: string,
  language: string,
): Entity[] {
  const entities: Entity[] = [];
  const ctx: VisitorContext = {
    filePath,
    language,
    parentNames: [],
    insideClass: false,
    isExported: false,
  };

  visitChildren(root, ctx, entities);
  return entities;
}

// ─── Visitor Core ────────────────────────────────────────────────

function visitChildren(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  for (const child of node.children()) {
    visitNode(child, ctx, entities);
  }
}

function visitNode(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  switch (node.kind()) {
    case 'export_statement':
      handleExportStatement(node, ctx, entities);
      break;
    case 'class_declaration':
      handleClassDeclaration(node, ctx, entities, visitNode);
      break;
    case 'interface_declaration':
      handleInterfaceDeclaration(node, ctx, entities);
      break;
    case 'function_declaration':
      handleFunctionDeclaration(node, ctx, entities);
      break;
    case 'lexical_declaration':
    case 'variable_declaration':
      handleVariableDeclaration(node, ctx, entities);
      break;
    case 'type_alias_declaration':
      handleTypeAliasDeclaration(node, ctx, entities);
      break;
    case 'enum_declaration':
      handleEnumDeclaration(node, ctx, entities);
      break;
    case 'internal_module':
      handleNamespace(node, ctx, entities, visitChildren);
      break;
    case 'decorator':
      handleDecorator(node, ctx, entities);
      break;
    default:
      visitChildren(node, ctx, entities);
      break;
  }
}

// ─── Export Statement ────────────────────────────────────────────

function handleExportStatement(
  node: SgNode,
  ctx: VisitorContext,
  entities: Entity[],
): void {
  const prevExported = ctx.isExported;
  ctx.isExported = true;

  for (const child of node.children()) {
    const ck = child.kind();
    if (ck !== 'export' && ck !== 'default') {
      visitNode(child, ctx, entities);
    }
  }

  ctx.isExported = prevExported;
}
