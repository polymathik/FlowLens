/**
 * Call relation extraction: direct function calls and this.method() calls.
 *
 * Identifies function/method calls within the same file and creates
 * relations from the calling entity to the callee entity.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import {
  walkNodes,
  buildEntityNameMap,
  buildClassMethodMap,
  findEnclosingFunctionEntity,
  findEnclosingClassName,
  getCallExpressionCallee,
} from './shared.js';

// ─── Public API ─────────────────────────────────────────────────

export function extractCallRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);
  const methodsByClass = buildClassMethodMap(entities);

  walkNodes(root, (node) => {
    if (node.kind() !== 'call_expression') return;

    const callee = getCallExpressionCallee(node);
    if (!callee) return;

    const callerEntity = findEnclosingFunctionEntity(node, filePath, entities);
    if (!callerEntity) return;

    if (callee.kind() === 'identifier') {
      handleDirectCall(callee, callerEntity, entityByName, node, filePath, relations);
    } else if (callee.kind() === 'member_expression') {
      handleMemberCall(callee, callerEntity, methodsByClass, node, filePath, relations);
    }
  });
}

// ─── Direct Call ────────────────────────────────────────────────

function handleDirectCall(
  callee: SgNode,
  callerEntity: Entity,
  entityByName: Map<string, Entity>,
  callNode: SgNode,
  filePath: string,
  relations: Relation[],
): void {
  const name = callee.text();
  if (name === 'require') return;

  const targetEntity = entityByName.get(name);
  if (!targetEntity) return;
  if (targetEntity.kind !== 'function' && targetEntity.kind !== 'method') return;

  createCallRelation(callerEntity, targetEntity, callNode, filePath, relations);
}

// ─── Member Call ────────────────────────────────────────────────

function handleMemberCall(
  callee: SgNode,
  callerEntity: Entity,
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
    const enclosingClassName = findEnclosingClassName(callNode);
    if (!enclosingClassName) return;

    const classMethods = methodsByClass.get(enclosingClassName);
    if (!classMethods) return;

    const targetEntity = classMethods.get(methodName);
    if (!targetEntity) return;

    createCallRelation(callerEntity, targetEntity, callNode, filePath, relations);
  }
}

// ─── Relation Creation ──────────────────────────────────────────

function createCallRelation(
  from: Entity,
  to: Entity,
  callNode: SgNode,
  filePath: string,
  relations: Relation[],
): void {
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
