/**
 * Shared helpers for AST entity extraction: tree traversal utilities,
 * visibility resolution, entity construction, and location mapping.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility, Location } from '../contracts/entities.js';
import { generateEntityId } from '../utils/id.js';

/**
 * Context passed down during recursive AST traversal.
 * Tracks the parent entity hierarchy for qualified name construction
 * and visibility inference.
 */
export interface VisitorContext {
  filePath: string;
  language: string;
  /** Stack of parent entity names for building qualified names */
  parentNames: string[];
  /** Whether we are currently inside a class body */
  insideClass: boolean;
  /** Whether the current node is exported (has `export` keyword) */
  isExported: boolean;
}

// ─── Tree Helpers ────────────────────────────────────────────────

/** Find the first direct child of `node` whose kind matches `kind`. */
export function findChild(node: SgNode, kind: string): SgNode | null {
  for (const child of node.children()) {
    if (child.kind() === kind) return child;
  }
  return null;
}

/** Find the first direct child of `node` with the given kind and return its text. */
export function findChildText(node: SgNode, kind: string): string | null {
  const child = findChild(node, kind);
  return child ? child.text() : null;
}

// ─── Visibility Resolution ───────────────────────────────────────

/** Resolve visibility for module-scope declarations (exported vs internal). */
export function resolveTopLevelVisibility(ctx: VisitorContext): Visibility {
  return ctx.isExported ? 'public' : 'internal';
}

/** Resolve visibility for class members based on accessibility modifier. */
export function resolveClassMemberVisibility(node: SgNode): Visibility {
  for (const child of node.children()) {
    if (child.kind() === 'accessibility_modifier') {
      const mod = child.text();
      if (mod === 'private') return 'private';
      if (mod === 'protected') return 'protected';
      if (mod === 'public') return 'public';
    }
  }
  // TypeScript default for class members without modifier is public
  return 'public';
}

// ─── Entity Construction ─────────────────────────────────────────

/**
 * Build a qualified name from file path, parent hierarchy, and entity name.
 *
 * Format: `{filePath}/{ParentHierarchy}.{name}` where hierarchy uses `.`
 * for nesting.
 */
export function buildQualifiedName(
  filePath: string,
  parentNames: string[],
  name: string,
): string {
  if (parentNames.length === 0) {
    return `${filePath}/${name}`;
  }
  return `${filePath}/${parentNames.join('.')}.${name}`;
}

/**
 * Convert ast-grep's 0-based range to our 1-based Location.
 */
export function nodeLocation(node: SgNode): Location {
  const range = node.range();
  return {
    line_start: range.start.line + 1,
    line_end: range.end.line + 1,
    column_start: range.start.column + 1,
    column_end: range.end.column + 1,
  };
}

/**
 * Create a fully-populated Entity from an AST node.
 */
export function createEntity(
  node: SgNode,
  name: string,
  kind: EntityKind,
  visibility: Visibility,
  ctx: VisitorContext,
): Entity {
  const qualifiedName = buildQualifiedName(ctx.filePath, ctx.parentNames, name);
  const location = nodeLocation(node);
  const lineCount = location.line_end - location.line_start + 1;

  return {
    id: generateEntityId(ctx.filePath, qualifiedName, kind),
    kind,
    name,
    qualified_name: qualifiedName,
    file: ctx.filePath,
    location,
    visibility,
    language: ctx.language,
    metrics: { line_count: lineCount },
  };
}
