/**
 * Shared relation-building helpers for the *basic* language extractors
 * (Kotlin, C#, PHP, Rust, C, C++, Swift, Scala, Ruby — "file-level +
 * same-file" scope, see the Phase 8 language table).
 *
 * Phase 8: targets named in source are never hashed into fabricated ids.
 * `addRelationByName` emits a pending relation (`to: ''`, `target_name`) that
 * pass 2 resolves against the file's own declarations; anything else is
 * dropped as external. Import statements of these languages are recorded as
 * explicit *unresolved* imports (their module systems are not resolved yet)
 * instead of edges to fabricated ids that always dangled.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import { nodeLocation } from '../extractor-helpers.js';
import type { PendingRelation } from '../../contracts/symbols.js';
import { fileId } from '../symbols/import-edges.js';

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
    entityMap: firstByName(entities),
    filePath,
  };
}

/**
 * Name → entity, first declaration wins, preferring top-level declarations
 * (`file/Name`) over members so `B.m` never shadows a top-level `m`.
 */
function firstByName(entities: Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  const topLevel = (e: Entity) => e.qualified_name === `${e.file}/${e.name}`;
  for (const e of entities) {
    if (e.kind === 'file' || e.kind === 'parameter' || e.kind === 'decorator') continue;
    const prev = map.get(e.name);
    if (!prev || (!topLevel(prev) && topLevel(e))) map.set(e.name, e);
  }
  return map;
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

/** Add a relation whose target is only known by name: pending for pass 2. */
export function addRelationByName(
  ctx: RelationContext,
  from: Entity,
  targetName: string,
  type: RelationType,
  node: SgNode,
): void {
  const local = ctx.entityMap.get(targetName);
  if (local && local.kind !== 'method') {
    addRelation(ctx, from, local, type, node);
    return;
  }
  const loc = nodeLocation(node);
  const rel: PendingRelation = {
    id: generateRelationId(from.id, `?${targetName}`, type, ctx.filePath, loc.line_start),
    from: from.id,
    to: '',
    type,
    location: { file: ctx.filePath, line: loc.line_start, column: loc.column_start },
    weight: 1,
    confidence: 0.8,
    resolution: 'unresolved',
    target_name: targetName,
  };
  ctx.relations.push(rel);
}

/**
 * Import statements of basic-scope languages: module resolution is not
 * implemented for them, so the import is recorded as an explicit unresolved
 * relation (`final`: pass 2 does not try to resolve it).
 */
export function addImportRelation(ctx: RelationContext, node: SgNode): void {
  const loc = nodeLocation(node);
  const sourceId = fileId(ctx.filePath);
  const text = node.text().replace(/\s+/g, ' ').trim().slice(0, 200);
  const rel: PendingRelation = {
    id: generateRelationId(sourceId, `?${text}`, 'import', ctx.filePath, loc.line_start),
    from: sourceId,
    to: '',
    type: 'import',
    location: { file: ctx.filePath, line: loc.line_start, column: loc.column_start },
    weight: 1,
    confidence: 1,
    resolution: 'unresolved',
    target_name: text,
    final: true,
  };
  ctx.relations.push(rel);
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
  const qn = `${classEntity.qualified_name}.${name}`;
  return ctx.entities.find(e => e.qualified_name === qn && e.kind === 'method') ?? null;
}
