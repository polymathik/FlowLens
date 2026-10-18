/**
 * Shared state for TS/JS relation extraction: the relation emitter, the
 * lexical scope frame carried through the single AST walk, and helpers to
 * read names from declaration nodes.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { RelationEmitter } from '../symbols/emitter.js';
import { generateEntityId } from '../../utils/id.js';
import path from 'node:path';

export interface ClassScope {
  entity: Entity;
  /** Source text of the extended class (`Base`, `ns.Base`), if any. */
  parentRef: string | null;
}

/** Lexical scope at a node: enclosing named declarations. */
export interface ScopeFrame {
  /** Names of enclosing named declarations (classes, functions, methods, namespaces). */
  path: string[];
  /** Innermost enclosing extracted entity (function / method / class), if any. */
  entity: Entity | undefined;
  cls: ClassScope | null;
  /** Inside a `throw` statement (new X → throw, not create). */
  inThrow: boolean;
}

export interface TsRelationContext {
  filePath: string;
  rootDir: string;
  emitter: RelationEmitter;
  symbols: FileSymbols;
  fileEntityId: string;
  /** Decorator entities by `line:column` of their node. */
  decoratorsAt: Map<string, Entity>;
}

export const CLASS_KINDS = new Set(['class_declaration', 'abstract_class_declaration', 'class']);
export const FUNCTION_KINDS = new Set([
  'function_declaration', 'generator_function_declaration',
]);
export const ANON_FUNCTION_KINDS = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);

export function createTsContext(
  filePath: string, rootDir: string, entities: Entity[], symbols: FileSymbols,
): TsRelationContext {
  const decoratorsAt = new Map<string, Entity>();
  for (const e of entities) {
    if (e.kind === 'decorator') decoratorsAt.set(`${e.location.line_start}:${e.location.column_start}`, e);
  }
  return {
    filePath,
    rootDir,
    emitter: new RelationEmitter(filePath, entities, symbols),
    symbols,
    fileEntityId: fileEntityIdFor(filePath),
    decoratorsAt,
  };
}

export function fileEntityIdFor(filePath: string): string {
  return generateEntityId(filePath, path.basename(filePath), 'file');
}

export function rootFrame(): ScopeFrame {
  return { path: [], entity: undefined, cls: null, inThrow: false };
}

/** Name of a class / function / namespace declaration node. */
export function declName(node: SgNode): string | null {
  for (const c of node.children()) {
    const k = c.kind();
    if (k === 'type_identifier' || k === 'identifier') return c.text();
  }
  return null;
}

/** Name of a method_definition node. */
export function methodName(node: SgNode): string | null {
  for (const c of node.children()) {
    const k = c.kind();
    if (k === 'property_identifier' || k === 'private_property_identifier') return c.text();
  }
  return null;
}

/** Variable name for `const x = () => …` / `const x = function () {}`. */
export function assignedName(fnNode: SgNode): string | null {
  const parent = fnNode.parent();
  if (!parent || parent.kind() !== 'variable_declarator') return null;
  const id = parent.children()[0];
  return id && id.kind() === 'identifier' ? id.text() : null;
}

export function sameNode(a: SgNode | null | undefined, b: SgNode): boolean {
  if (!a) return false;
  const ra = a.range();
  const rb = b.range();
  return ra.start.index === rb.start.index && ra.end.index === rb.end.index && a.kind() === b.kind();
}

/** Dotted reference text for identifier / member_expression / nested type nodes, else null. */
export function refText(node: SgNode): string | null {
  const k = node.kind();
  if (k === 'identifier' || k === 'type_identifier') return node.text();
  if (k === 'member_expression' || k === 'nested_type_identifier' || k === 'nested_identifier') {
    const text = node.text();
    return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(text) ? text : null;
  }
  if (k === 'generic_type') {
    const inner = node.children()[0];
    return inner ? refText(inner) : null;
  }
  return null;
}
