/**
 * Shared helpers for relation extraction modules.
 *
 * Provides entity lookup, AST traversal, and enclosing-entity
 * resolution used across all relation extraction modules.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import { findChild } from '../extractor-helpers.js';

// ─── Entity Lookup ──────────────────────────────────────────────

/** Find an entity by name from the entities array. */
export function findEntityByName(entities: Entity[], name: string): Entity | undefined {
  return entities.find(e => e.name === name);
}

/**
 * Build a name-to-entity lookup map. For entities with duplicate names,
 * preference is given to function/method/class/interface kinds.
 */
export function buildEntityNameMap(entities: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const entity of entities) {
    if (entity.kind === 'file' || entity.kind === 'parameter') continue;
    const existing = map.get(entity.name);
    if (!existing) {
      map.set(entity.name, entity);
    }
  }
  return map;
}

/**
 * Build a map of className -> methodName -> Entity for quick method lookup.
 */
export function buildClassMethodMap(entities: Entity[]): Map<string, Map<string, Entity>> {
  const map = new Map<string, Map<string, Entity>>();

  for (const entity of entities) {
    if (entity.kind !== 'method') continue;
    const qn = entity.qualified_name;
    const slashIdx = qn.lastIndexOf('/');
    const rest = slashIdx >= 0 ? qn.slice(slashIdx + 1) : qn;
    const dotIdx = rest.indexOf('.');
    if (dotIdx < 0) continue;

    const className = rest.slice(0, dotIdx);
    if (!map.has(className)) {
      map.set(className, new Map());
    }
    map.get(className)!.set(entity.name, entity);
  }

  return map;
}

// ─── AST Traversal ──────────────────────────────────────────────

/** Walk all nodes in an AST tree, calling the callback for each. */
export function walkNodes(node: SgNode, callback: (node: SgNode) => void): void {
  callback(node);
  for (const child of node.children()) {
    walkNodes(child, callback);
  }
}

// ─── Enclosing Entity Resolution ────────────────────────────────

/** Find the name of a class_declaration node. */
export function findClassDeclarationName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'type_identifier' || child.kind() === 'identifier') {
      return child.text();
    }
  }
  return null;
}

/** Walk up the AST to find the enclosing class name. */
export function findEnclosingClassName(node: SgNode): string | null {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === 'class_declaration') {
      return findClassDeclarationName(current);
    }
    current = current.parent();
  }
  return null;
}

/** Extract function name from a function_declaration node. */
export function findFunctionName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
  }
  return null;
}

/** Extract method name from a method_definition node. */
export function findMethodName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'property_identifier') return child.text();
  }
  return null;
}

/**
 * Walk up the AST to find the enclosing function/method entity.
 */
export function findEnclosingFunctionEntity(
  node: SgNode,
  filePath: string,
  entities: Entity[],
): Entity | null {
  let current: SgNode | null = node.parent();

  while (current) {
    const kind = current.kind();

    if (kind === 'function_declaration') {
      const name = findFunctionName(current);
      if (name) {
        return entities.find(
          e => e.name === name && (e.kind === 'function') && e.file === filePath,
        ) ?? null;
      }
    }

    if (kind === 'method_definition') {
      const name = findMethodName(current);
      if (name) {
        return entities.find(
          e => e.name === name && e.kind === 'method' && e.file === filePath,
        ) ?? null;
      }
    }

    if (kind === 'arrow_function') {
      const declarator = current.parent();
      if (declarator && declarator.kind() === 'variable_declarator') {
        const nameNode = findChild(declarator, 'identifier');
        if (nameNode) {
          return entities.find(
            e => e.name === nameNode.text() && e.kind === 'function' && e.file === filePath,
          ) ?? null;
        }
      }
    }

    current = current.parent();
  }

  return null;
}

/**
 * Find the containing entity (function, method, or class) for an AST node.
 * Broader than findEnclosingFunctionEntity — also returns class entities.
 */
export function findContainingEntity(
  node: SgNode,
  entities: Entity[],
  filePath: string,
): Entity | undefined {
  // Try function/method first
  const fnEntity = findEnclosingFunctionEntity(node, filePath, entities);
  if (fnEntity) return fnEntity;

  // Fall back to enclosing class
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === 'class_declaration') {
      const name = findClassDeclarationName(current);
      if (name) {
        return entities.find(
          e => e.name === name && e.kind === 'class' && e.file === filePath,
        );
      }
    }
    current = current.parent();
  }
  return undefined;
}

/**
 * Get the callee part of a call_expression (the function/identifier being called).
 */
export function getCallExpressionCallee(node: SgNode): SgNode | null {
  const children = node.children();
  for (const child of children) {
    if (child.kind() === 'arguments') break;
    if (child.kind() !== '(' && child.kind() !== ')') {
      return child;
    }
  }
  return null;
}

// ─── Function Entity Resolution ─────────────────────────────────

/** Find the function/method entity for a function/method/arrow_function AST node. */
export function findFnEntity(node: SgNode, entities: Entity[], filePath: string): Entity | undefined {
  const kind = node.kind();

  if (kind === 'function_declaration') {
    const name = findChild(node, 'identifier')?.text();
    if (name) return entities.find(e => e.name === name && e.kind === 'function' && e.file === filePath);
  }

  if (kind === 'method_definition') {
    const name = findChild(node, 'property_identifier')?.text();
    if (name) return entities.find(e => e.name === name && e.kind === 'method' && e.file === filePath);
  }

  if (kind === 'arrow_function') {
    const declarator = node.parent();
    if (declarator && declarator.kind() === 'variable_declarator') {
      const nameNode = findChild(declarator, 'identifier');
      if (nameNode) {
        return entities.find(e => e.name === nameNode.text() && e.kind === 'function' && e.file === filePath);
      }
    }
  }

  return undefined;
}

// ─── AST Search Helpers ─────────────────────────────────────────

/** Find the first descendant with the given kind (recursive). */
export function findDescendant(node: SgNode, kind: string): SgNode | null {
  for (const child of node.children()) {
    if (child.kind() === kind) return child;
    const found = findDescendant(child, kind);
    if (found) return found;
  }
  return null;
}

/**
 * Extract type names referenced in a type annotation.
 * Handles: type_identifier, generic_type (e.g., Promise<User>).
 */
export function extractTypeNames(typeAnnotation: SgNode): string[] {
  const names: string[] = [];
  walkNodes(typeAnnotation, (n) => {
    if (n.kind() === 'type_identifier') {
      names.push(n.text());
    }
  });
  return names;
}

/** Extract the constructor target name from a new_expression. */
export function extractNewExpressionTarget(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
    if (child.kind() === 'arguments') break;
  }
  return null;
}
