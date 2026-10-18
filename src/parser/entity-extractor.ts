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
    case 'abstract_class_declaration':
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
    default:
      // Only statement containers can hold module-level declarations; never
      // descend into expressions or function bodies (locals are not entities,
      // and expression depth is unbounded).
      if (STATEMENT_CONTAINERS.has(String(node.kind()))) visitChildren(node, ctx, entities);
      break;
  }
}

const STATEMENT_CONTAINERS = new Set([
  'program', 'statement_block', 'if_statement', 'else_clause', 'try_statement',
  'catch_clause', 'finally_clause', 'labeled_statement', 'ambient_declaration',
  'switch_statement', 'switch_body', 'switch_case', 'switch_default',
]);

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
