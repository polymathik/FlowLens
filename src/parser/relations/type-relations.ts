/**
 * Type relation extraction: parameter, return, throw.
 *
 * Detects type-level relationships between functions/methods and
 * the types/classes they reference via parameters, return types,
 * and throw statements.
 *
 * Decorator relations are in decorate-relations.ts.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import { findChild } from '../extractor-helpers.js';
import {
  walkNodes,
  buildEntityNameMap,
  findContainingEntity,
  findFnEntity,
  findDescendant,
  extractTypeNames,
  extractNewExpressionTarget,
} from './shared.js';

// ─── Public API ─────────────────────────────────────────────────

export function extractTypeRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);

  extractParameterRelations(root, filePath, entities, entityByName, relations);
  extractReturnRelations(root, filePath, entities, entityByName, relations);
  extractThrowRelations(root, filePath, entities, entityByName, relations);
}

// ─── Parameter Relations ────────────────────────────────────────

/**
 * For each function/method, examine parameter type annotations.
 * If the type references a known entity, create a 'parameter' relation.
 */
function extractParameterRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  relations: Relation[],
): void {
  walkNodes(root, (node) => {
    const kind = node.kind();
    if (kind !== 'function_declaration' && kind !== 'method_definition' && kind !== 'arrow_function') return;

    const fnEntity = findFnEntity(node, entities, filePath);
    if (!fnEntity) return;

    const params = findChild(node, 'formal_parameters');
    if (!params) return;

    for (const param of params.children()) {
      const pk = param.kind();
      if (pk !== 'required_parameter' && pk !== 'optional_parameter') continue;

      const typeAnnotation = findChild(param, 'type_annotation');
      if (!typeAnnotation) continue;

      const typeNames = extractTypeNames(typeAnnotation);
      for (const typeName of typeNames) {
        const targetEntity = entityByName.get(typeName);
        if (!targetEntity) continue;

        const range = param.range();
        const line = range.start.line + 1;
        const column = range.start.column + 1;

        relations.push({
          id: generateRelationId(fnEntity.id, targetEntity.id, 'parameter', filePath, line),
          from: fnEntity.id,
          to: targetEntity.id,
          type: 'parameter',
          location: { file: filePath, line, column },
          weight: 1,
          confidence: 1.0,
        });
      }
    }
  });
}

// ─── Return Relations ───────────────────────────────────────────

/**
 * Examine return type annotations. If referencing a known entity,
 * create a 'return' relation.
 */
function extractReturnRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  relations: Relation[],
): void {
  walkNodes(root, (node) => {
    const kind = node.kind();
    if (kind !== 'function_declaration' && kind !== 'method_definition' && kind !== 'arrow_function') return;

    const fnEntity = findFnEntity(node, entities, filePath);
    if (!fnEntity) return;

    const returnType = findReturnTypeAnnotation(node);
    if (!returnType) return;

    const typeNames = extractTypeNames(returnType);
    for (const typeName of typeNames) {
      if (typeName === 'void' || typeName === 'undefined' || typeName === 'null') continue;

      const targetEntity = entityByName.get(typeName);
      if (!targetEntity) continue;

      const range = returnType.range();
      const line = range.start.line + 1;
      const column = range.start.column + 1;

      relations.push({
        id: generateRelationId(fnEntity.id, targetEntity.id, 'return', filePath, line),
        from: fnEntity.id,
        to: targetEntity.id,
        type: 'return',
        location: { file: filePath, line, column },
        weight: 1,
        confidence: 1.0,
      });
    }
  });
}

// ─── Throw Relations ────────────────────────────────────────────

/**
 * Find throw_statement nodes containing new_expression. The new target
 * class is the relation target.
 */
function extractThrowRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  relations: Relation[],
): void {
  walkNodes(root, (node) => {
    if (node.kind() !== 'throw_statement') return;

    const newExpr = findDescendant(node, 'new_expression');
    if (!newExpr) return;

    const className = extractNewExpressionTarget(newExpr);
    if (!className) return;

    const targetEntity = entityByName.get(className);
    if (!targetEntity) return;

    const fnEntity = findContainingEntity(node, entities, filePath);
    if (!fnEntity) return;

    const range = node.range();
    const line = range.start.line + 1;
    const column = range.start.column + 1;

    relations.push({
      id: generateRelationId(fnEntity.id, targetEntity.id, 'throw', filePath, line),
      from: fnEntity.id,
      to: targetEntity.id,
      type: 'throw',
      location: { file: filePath, line, column },
      weight: 1,
      confidence: 1.0,
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────

/** Find the return type annotation for a function/method. */
function findReturnTypeAnnotation(node: SgNode): SgNode | null {
  let seenParams = false;
  for (const child of node.children()) {
    if (child.kind() === 'formal_parameters') {
      seenParams = true;
      continue;
    }
    if (seenParams && child.kind() === 'type_annotation') {
      return child;
    }
    if (child.kind() === 'statement_block' || child.kind() === '{') break;
  }
  return null;
}
