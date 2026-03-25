/**
 * Relation extraction for TypeScript/JavaScript ASTs.
 *
 * Extracts 4 core relation types from a parsed AST:
 *  - import:    file A imports file B
 *  - call:      function/method A calls function/method B
 *  - extend:    class A extends class B
 *  - implement: class A implements interface B
 *
 * All relation targets must be resolvable to known entities within the
 * same file (for call/extend/implement) or via import resolution (for
 * import relations). Unresolvable targets are silently skipped.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import { generateEntityId, generateRelationId } from '../utils/id.js';
import { resolveImportPath } from './import-resolver.js';
import { findChild } from './extractor-helpers.js';
import path from 'node:path';

/**
 * Extract all relations from a parsed AST.
 *
 * @param root     - The root SgNode of the parsed file
 * @param filePath - Normalized relative file path
 * @param entities - Entities already extracted from this file
 * @param rootDir  - Project root directory (used for import resolution)
 */
export function extractRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  rootDir: string,
): Relation[] {
  const relations: Relation[] = [];

  extractImportRelations(root, filePath, rootDir, relations);
  extractCallRelations(root, filePath, entities, relations);
  extractInheritanceRelations(root, filePath, entities, relations);

  return relations;
}

// ─── Import Relations ───────────────────────────────────────────

function extractImportRelations(
  root: SgNode,
  filePath: string,
  rootDir: string,
  relations: Relation[],
): void {
  const fileEntityId = generateEntityId(
    filePath,
    path.basename(filePath),
    'file',
  );

  walkNodes(root, (node) => {
    const kind = node.kind();

    if (kind === 'import_statement') {
      handleImportStatement(node, filePath, rootDir, fileEntityId, relations);
    } else if (kind === 'export_statement') {
      handleReExport(node, filePath, rootDir, fileEntityId, relations);
    } else if (kind === 'call_expression') {
      handleDynamicImportOrRequire(node, filePath, rootDir, fileEntityId, relations);
    }
  });
}

/**
 * Handle ESM import statement: named, default, namespace.
 *
 * AST shape: import_statement > ... > string > string_fragment
 */
function handleImportStatement(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  const specifier = extractStringSpecifier(node);
  if (!specifier) return;

  createImportRelation(
    specifier, filePath, rootDir, fileEntityId,
    node, 1.0, relations,
  );
}

/**
 * Handle re-export: `export { Foo } from './foo'`.
 *
 * AST shape: export_statement with a `string` child containing the source.
 */
function handleReExport(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  // Only re-exports have a string child (not regular exports)
  const specifier = extractStringSpecifier(node);
  if (!specifier) return;

  createImportRelation(
    specifier, filePath, rootDir, fileEntityId,
    node, 1.0, relations,
  );
}

/**
 * Handle `require('./foo')` or `import('./foo')` / `import(\`./foo\`)`.
 */
function handleDynamicImportOrRequire(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  const functionPart = getCallExpressionCallee(node);
  if (!functionPart) return;

  const isRequire = functionPart.kind() === 'identifier' && functionPart.text() === 'require';
  const isDynamicImport = functionPart.kind() === 'import';

  if (!isRequire && !isDynamicImport) return;

  const args = findChild(node, 'arguments');
  if (!args) return;

  for (const arg of args.children()) {
    if (arg.kind() === 'string') {
      const fragment = findChild(arg, 'string_fragment');
      if (fragment) {
        createImportRelation(
          fragment.text(), filePath, rootDir, fileEntityId,
          node, 1.0, relations,
        );
      }
      return;
    }
    if (arg.kind() === 'template_string') {
      // Dynamic import with template literal — lower confidence
      const fragment = findChild(arg, 'string_fragment');
      if (fragment) {
        createImportRelation(
          fragment.text(), filePath, rootDir, fileEntityId,
          node, 0.75, relations,
        );
      }
      return;
    }
  }
}

/**
 * Extract a string specifier from a node that has a `string` child
 * (import_statement, export_statement re-export).
 */
function extractStringSpecifier(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'string') {
      const fragment = findChild(child, 'string_fragment');
      return fragment ? fragment.text() : null;
    }
  }
  return null;
}

/**
 * Get the callee part of a call_expression (the function/identifier being called).
 */
function getCallExpressionCallee(node: SgNode): SgNode | null {
  const children = node.children();
  // The callee is typically the first child before `arguments`
  for (const child of children) {
    if (child.kind() === 'arguments') break;
    if (child.kind() !== '(' && child.kind() !== ')') {
      return child;
    }
  }
  return null;
}

/**
 * Create an import relation if the specifier resolves to a real file.
 */
function createImportRelation(
  specifier: string,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  node: SgNode,
  confidence: number,
  relations: Relation[],
): void {
  const resolved = resolveImportPath(specifier, filePath, rootDir);
  if (!resolved) return;

  const targetEntityId = generateEntityId(
    resolved,
    path.basename(resolved),
    'file',
  );

  const range = node.range();
  const line = range.start.line + 1;
  const column = range.start.column + 1;

  relations.push({
    id: generateRelationId(fileEntityId, targetEntityId, 'import', filePath, line),
    from: fileEntityId,
    to: targetEntityId,
    type: 'import',
    location: { file: filePath, line, column },
    weight: 1,
    confidence,
  });
}

// ─── Call Relations ─────────────────────────────────────────────

function extractCallRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  // Build lookup maps for quick entity resolution
  const entityByName = buildEntityNameMap(entities);
  const methodsByClass = buildClassMethodMap(entities);

  walkNodes(root, (node) => {
    if (node.kind() !== 'call_expression') return;

    const callee = getCallExpressionCallee(node);
    if (!callee) return;

    const callerEntity = findEnclosingFunctionEntity(node, filePath, entities);
    if (!callerEntity) return;

    if (callee.kind() === 'identifier') {
      // Direct function call: foo()
      handleDirectCall(callee, callerEntity, entityByName, node, filePath, relations);
    } else if (callee.kind() === 'member_expression') {
      // Method call: obj.method() or this.method()
      handleMemberCall(callee, callerEntity, entities, methodsByClass, node, filePath, relations);
    }
  });
}

/**
 * Handle a direct function call: `foo()`.
 * Only create relation if `foo` is a known entity (function or variable).
 */
function handleDirectCall(
  callee: SgNode,
  callerEntity: Entity,
  entityByName: Map<string, Entity>,
  callNode: SgNode,
  filePath: string,
  relations: Relation[],
): void {
  const name = callee.text();

  // Skip built-in calls like require, import
  if (name === 'require') return;

  const targetEntity = entityByName.get(name);
  if (!targetEntity) return;

  // Only match functions (not classes, interfaces, etc.)
  if (targetEntity.kind !== 'function' && targetEntity.kind !== 'method') return;

  createCallRelation(callerEntity, targetEntity, callNode, filePath, relations);
}

/**
 * Handle a member call: `this.method()` or `obj.method()`.
 */
function handleMemberCall(
  callee: SgNode,
  callerEntity: Entity,
  entities: Entity[],
  methodsByClass: Map<string, Map<string, Entity>>,
  callNode: SgNode,
  filePath: string,
  relations: Relation[],
): void {
  const children = callee.children();
  if (children.length < 3) return;

  const objectNode = children[0];
  const propertyNode = children[children.length - 1];
  const methodName = propertyNode.text();

  if (objectNode.kind() === 'this') {
    // this.method() — find the enclosing class and look up the method
    const enclosingClassName = findEnclosingClassName(callNode);
    if (!enclosingClassName) return;

    const classMethods = methodsByClass.get(enclosingClassName);
    if (!classMethods) return;

    const targetEntity = classMethods.get(methodName);
    if (!targetEntity) return;

    createCallRelation(callerEntity, targetEntity, callNode, filePath, relations);
  } else {
    // obj.method() — try to resolve if obj is a known entity with methods
    // For now, we only resolve this.method() calls within same class
    // Cross-object method resolution requires type inference (future work)
  }
}

/**
 * Create a call relation between caller and callee entities.
 */
function createCallRelation(
  from: Entity,
  to: Entity,
  callNode: SgNode,
  filePath: string,
  relations: Relation[],
): void {
  // Don't create self-calls (e.g. recursive calls within same function)
  // unless they are actually different entities
  const range = callNode.range();
  const line = range.start.line + 1;
  const column = range.start.column + 1;

  relations.push({
    id: generateRelationId(from.id, to.id, 'call', filePath, line),
    from: from.id,
    to: to.id,
    type: 'call',
    location: { file: filePath, line, column },
    weight: 1,
    confidence: 1.0,
  });
}

// ─── Extend & Implement Relations ───────────────────────────────

function extractInheritanceRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);

  walkNodes(root, (node) => {
    if (node.kind() !== 'class_declaration') return;

    const className = findClassDeclarationName(node);
    if (!className) return;

    const classEntity = entityByName.get(className);
    if (!classEntity) return;

    const heritage = findChild(node, 'class_heritage');
    if (!heritage) return;

    for (const clause of heritage.children()) {
      if (clause.kind() === 'extends_clause') {
        handleExtendsClause(clause, classEntity, entityByName, filePath, relations);
      } else if (clause.kind() === 'implements_clause') {
        handleImplementsClause(clause, classEntity, entityByName, filePath, relations);
      }
    }
  });
}

/**
 * Handle `extends Base` — create extend relation.
 *
 * AST: extends_clause > extends + identifier (or type_identifier)
 */
function handleExtendsClause(
  clause: SgNode,
  classEntity: Entity,
  entityByName: Map<string, Entity>,
  filePath: string,
  relations: Relation[],
): void {
  for (const child of clause.children()) {
    if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
      const parentName = child.text();
      const parentEntity = entityByName.get(parentName);
      if (!parentEntity) continue;

      const range = clause.range();
      const line = range.start.line + 1;
      const column = range.start.column + 1;

      relations.push({
        id: generateRelationId(classEntity.id, parentEntity.id, 'extend', filePath, line),
        from: classEntity.id,
        to: parentEntity.id,
        type: 'extend',
        location: { file: filePath, line, column },
        weight: 1,
        confidence: 1.0,
      });
      break; // A class can only extend one parent
    }
  }
}

/**
 * Handle `implements IA, IB` — create implement relation for each interface.
 *
 * AST: implements_clause > implements + type_identifier (, type_identifier)*
 */
function handleImplementsClause(
  clause: SgNode,
  classEntity: Entity,
  entityByName: Map<string, Entity>,
  filePath: string,
  relations: Relation[],
): void {
  for (const child of clause.children()) {
    if (child.kind() === 'type_identifier') {
      const ifaceName = child.text();
      const ifaceEntity = entityByName.get(ifaceName);
      if (!ifaceEntity) continue;

      const range = child.range();
      const line = range.start.line + 1;
      const column = range.start.column + 1;

      relations.push({
        id: generateRelationId(classEntity.id, ifaceEntity.id, 'implement', filePath, line),
        from: classEntity.id,
        to: ifaceEntity.id,
        type: 'implement',
        location: { file: filePath, line, column },
        weight: 1,
        confidence: 1.0,
      });
    }
  }
}

// ─── Helper Utilities ───────────────────────────────────────────

/**
 * Build a name-to-entity lookup map. For entities with duplicate names,
 * preference is given to function/method/class/interface kinds.
 */
function buildEntityNameMap(entities: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const entity of entities) {
    // Skip file-level entities and parameters for name resolution
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
function buildClassMethodMap(entities: Entity[]): Map<string, Map<string, Entity>> {
  const map = new Map<string, Map<string, Entity>>();

  for (const entity of entities) {
    if (entity.kind !== 'method') continue;
    // Extract class name from qualified_name: "filePath/ClassName.methodName"
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

/**
 * Find the name of the class_declaration.
 */
function findClassDeclarationName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'type_identifier' || child.kind() === 'identifier') {
      return child.text();
    }
  }
  return null;
}

/**
 * Walk up the AST to find the enclosing function/method entity.
 */
function findEnclosingFunctionEntity(
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
      // Arrow functions assigned to const: walk up to variable_declarator
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
 * Walk up the AST to find the enclosing class name.
 */
function findEnclosingClassName(node: SgNode): string | null {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === 'class_declaration') {
      return findClassDeclarationName(current);
    }
    current = current.parent();
  }
  return null;
}

/**
 * Extract function name from a function_declaration node.
 */
function findFunctionName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
  }
  return null;
}

/**
 * Extract method name from a method_definition node.
 */
function findMethodName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'property_identifier') return child.text();
  }
  return null;
}

/**
 * Walk all nodes in an AST tree, calling the callback for each.
 */
function walkNodes(node: SgNode, callback: (node: SgNode) => void): void {
  callback(node);
  for (const child of node.children()) {
    walkNodes(child, callback);
  }
}
