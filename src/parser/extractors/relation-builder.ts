/**
 * Shared relation-building helpers for language extractors.
 *
 * Provides a factory that creates pre-configured `addRelation` and
 * `addRelationByName` functions, plus common import/create/call handlers.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import { generateEntityId, generateRelationId } from '../../utils/id.js';
import { nodeLocation, findChildText } from '../extractor-helpers.js';

export interface RelationContext {
  relations: Relation[];
  entities: Entity[];
  entityMap: Map<string, Entity>;
  filePath: string;
}

/** Create a relation context from entities and filePath. */
export function createRelationContext(
  filePath: string,
  entities: Entity[],
): RelationContext {
  return {
    relations: [],
    entities,
    entityMap: new Map(entities.map(e => [e.name, e])),
    filePath,
  };
}

/** Add a relation between two known entities. */
export function addRelation(
  ctx: RelationContext,
  from: Entity,
  to: Entity,
  type: RelationType,
  node: SgNode,
): void {
  const loc = nodeLocation(node);
  ctx.relations.push({
    id: generateRelationId(from.id, to.id, type, ctx.filePath, loc.line_start),
    from: from.id,
    to: to.id,
    type,
    location: { file: ctx.filePath, line: loc.line_start, column: loc.column_start },
    weight: 1,
    confidence: 1,
  });
}

/** Add a relation where the target is identified by name (not yet resolved). */
export function addRelationByName(
  ctx: RelationContext,
  from: Entity,
  targetName: string,
  type: RelationType,
  node: SgNode,
): void {
  const targetId = generateEntityId(ctx.filePath, targetName, 'class');
  const loc = nodeLocation(node);
  ctx.relations.push({
    id: generateRelationId(from.id, targetId, type, ctx.filePath, loc.line_start),
    from: from.id,
    to: targetId,
    type,
    location: { file: ctx.filePath, line: loc.line_start, column: loc.column_start },
    weight: 1,
    confidence: 0.8,
  });
}

/** Create an import relation from the file entity (or synthetic) to a target. */
export function addImportRelation(ctx: RelationContext, node: SgNode): void {
  const loc = nodeLocation(node);
  const importText = node.text();
  const targetId = generateEntityId(ctx.filePath, importText, 'import');
  const sourceId = ctx.entities.find(e => e.kind === 'file')?.id
    ?? generateEntityId(ctx.filePath, ctx.filePath, 'file');
  ctx.relations.push({
    id: generateRelationId(sourceId, targetId, 'import', ctx.filePath, loc.line_start),
    from: sourceId,
    to: targetId,
    type: 'import',
    location: { file: ctx.filePath, line: loc.line_start, column: loc.column_start },
    weight: 1,
    confidence: 1,
  });
}

/** Handle a call expression — creates 'call' or 'create' depending on target kind. */
export function handleCallOrCreate(
  ctx: RelationContext,
  currentEntity: Entity | null,
  calleeName: string,
  node: SgNode,
): void {
  if (!currentEntity) return;
  const target = ctx.entityMap.get(calleeName);
  if (!target) return;
  if (target.kind === 'class') {
    addRelation(ctx, currentEntity, target, 'create', node);
  } else {
    addRelation(ctx, currentEntity, target, 'call', node);
  }
}

/** Find a method entity belonging to a class by name. */
export function findMethodEntity(
  ctx: RelationContext,
  name: string,
  classEntity: Entity | null,
): Entity | null {
  if (!classEntity) return ctx.entityMap.get(name) ?? null;
  return ctx.entities.find(
    e => e.name === name && e.kind === 'method'
      && e.qualified_name.includes(`${classEntity.name}.`),
  ) ?? null;
}
