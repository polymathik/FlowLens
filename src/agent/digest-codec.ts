/** Compact tuple encoding for entities/relations stored in the agent digest. */
import type { AgentEntityReference } from '../contracts/agent.js';
import type { Entity, EntityKind } from '../contracts/entities.js';
import type { Relation, RelationType } from '../contracts/relations.js';

/** [id, kind, name, qualified_name, file, line_start, line_end, col_start, col_end, language, quality, hotspot, afferent] */
export type CompactEntity = [
  string, string, string, string, string,
  number, number, number, number,
  string, number | null, number | null, number | null,
];

/** [id, from, to, type, file, line, column, weight, confidence] */
export type CompactRelation = [string, string, string, string, string, number, number, number, number];

export function compactEntity(entity: Entity): CompactEntity {
  const loc = entity.location;
  return [
    entity.id, entity.kind, entity.name, entity.qualified_name, entity.file,
    loc?.line_start ?? 0, loc?.line_end ?? 0, loc?.column_start ?? 0, loc?.column_end ?? 0,
    entity.language, entity.metrics?.quality_score ?? null, entity.metrics?.hotspot_score ?? null,
    entity.metrics?.afferent_coupling ?? null,
  ];
}

export function compactRelation(relation: Relation): CompactRelation {
  return [
    relation.id, relation.from, relation.to, relation.type,
    relation.location.file, relation.location.line, relation.location.column,
    relation.weight, relation.confidence,
  ];
}

export function expandEntity(row: CompactEntity, reason?: string): AgentEntityReference {
  return {
    id: row[0],
    kind: row[1] as EntityKind,
    name: row[2],
    qualified_name: row[3],
    file: row[4],
    location: { line_start: row[5], line_end: row[6], column_start: row[7], column_end: row[8] },
    language: row[9],
    quality_score: row[10] ?? undefined,
    hotspot_score: row[11] ?? undefined,
    reason,
  };
}

/** Rebuild an Entity with the fields analysis code reads (layers, severity, hotspots). */
export function entityFromCompact(row: CompactEntity): Entity {
  const metrics: NonNullable<Entity['metrics']> = { line_count: Math.max(row[6] - row[5] + 1, 0) };
  if (row[10] !== null) metrics.quality_score = row[10];
  if (row[11] !== null) metrics.hotspot_score = row[11];
  if (row[12] !== null) metrics.afferent_coupling = row[12];
  return {
    id: row[0],
    kind: row[1] as EntityKind,
    name: row[2],
    qualified_name: row[3],
    file: row[4],
    location: { line_start: row[5], line_end: row[6], column_start: row[7], column_end: row[8] },
    visibility: 'public',
    language: row[9],
    metrics,
  };
}

export function relationFromCompact(row: CompactRelation): Relation {
  return {
    id: row[0],
    from: row[1],
    to: row[2],
    type: row[3] as RelationType,
    location: { file: row[4], line: row[5], column: row[6] },
    weight: row[7],
    confidence: row[8],
  };
}
