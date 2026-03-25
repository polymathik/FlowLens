/**
 * Inheritance relation extraction: extend, implement, override, mixin.
 *
 * Detects class inheritance, interface implementation, method overrides,
 * and mixin patterns from TypeScript/JavaScript ASTs.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import { findChild } from '../extractor-helpers.js';
import {
  walkNodes,
  buildEntityNameMap,
  buildClassMethodMap,
  findClassDeclarationName,
} from './shared.js';

// ─── Public API ─────────────────────────────────────────────────

export function extractInheritanceRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);
  const methodsByClass = buildClassMethodMap(entities);

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
        handleExtendsClause(clause, classEntity, className, entityByName, methodsByClass, filePath, relations);
      } else if (clause.kind() === 'implements_clause') {
        handleImplementsClause(clause, classEntity, entityByName, filePath, relations);
      }
    }
  });
}

// ─── Extends ────────────────────────────────────────────────────

function handleExtendsClause(
  clause: SgNode,
  classEntity: Entity,
  className: string,
  entityByName: Map<string, Entity>,
  methodsByClass: Map<string, Map<string, Entity>>,
  filePath: string,
  relations: Relation[],
): void {
  let parentName: string | null = null;
  let isMixin = false;

  for (const child of clause.children()) {
    if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
      parentName = child.text();
      break;
    }
    if (child.kind() === 'call_expression') {
      // Mixin pattern: class X extends Mixin(Base)
      isMixin = true;
      handleMixinExpression(child, classEntity, entityByName, filePath, relations);
      break;
    }
  }

  if (parentName && !isMixin) {
    const parentEntity = entityByName.get(parentName);
    if (parentEntity) {
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

      // Check for method overrides (same-file only)
      extractOverrideRelations(
        className, parentName, methodsByClass, filePath, relations,
      );
    }
  }
}

// ─── Implements ─────────────────────────────────────────────────

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

// ─── Override ───────────────────────────────────────────────────

/**
 * Detect method overrides: when a child class has a method with the
 * same name as a method in its parent class (same-file only).
 */
function extractOverrideRelations(
  childClassName: string,
  parentClassName: string,
  methodsByClass: Map<string, Map<string, Entity>>,
  filePath: string,
  relations: Relation[],
): void {
  const childMethods = methodsByClass.get(childClassName);
  const parentMethods = methodsByClass.get(parentClassName);
  if (!childMethods || !parentMethods) return;

  for (const [methodName, childMethod] of childMethods) {
    const parentMethod = parentMethods.get(methodName);
    if (!parentMethod) continue;

    // Use child method's location for the override relation
    const loc = childMethod.location;

    relations.push({
      id: generateRelationId(childMethod.id, parentMethod.id, 'override', filePath, loc.line_start),
      from: childMethod.id,
      to: parentMethod.id,
      type: 'override',
      location: { file: filePath, line: loc.line_start, column: loc.column_start },
      weight: 1,
      confidence: 1.0,
    });
  }
}

// ─── Mixin ──────────────────────────────────────────────────────

/**
 * Detect mixin pattern: `class X extends MixinFn(Base)`.
 * The callee function (MixinFn) is the mixin source.
 */
function handleMixinExpression(
  callExpr: SgNode,
  classEntity: Entity,
  entityByName: Map<string, Entity>,
  filePath: string,
  relations: Relation[],
): void {
  // The callee of the call_expression is the mixin function
  const children = callExpr.children();
  for (const child of children) {
    if (child.kind() === 'arguments') break;

    if (child.kind() === 'identifier') {
      const mixinName = child.text();
      const mixinEntity = entityByName.get(mixinName);

      const range = callExpr.range();
      const line = range.start.line + 1;
      const column = range.start.column + 1;

      if (mixinEntity) {
        relations.push({
          id: generateRelationId(classEntity.id, mixinEntity.id, 'mixin', filePath, line),
          from: classEntity.id,
          to: mixinEntity.id,
          type: 'mixin',
          location: { file: filePath, line, column },
          weight: 1,
          confidence: 1.0,
        });
      } else {
        // Mixin function may not be a local entity (e.g., imported).
        // Create relation with a synthetic target ID using the mixin name.
        // This allows the graph to record the relationship even for external mixins.
        relations.push({
          id: generateRelationId(classEntity.id, `unresolved:${mixinName}`, 'mixin', filePath, line),
          from: classEntity.id,
          to: `unresolved:${mixinName}`,
          type: 'mixin',
          location: { file: filePath, line, column },
          weight: 1,
          confidence: 0.5,
        });
      }
      break;
    }
  }
}
