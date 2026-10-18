import type { Entity } from '../contracts/entities.js';
import type { DetectedCycle } from '../contracts/analysis/cycles.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import type {
  AgentCycleReference,
  AgentEntityReference,
  AgentViolationReference,
} from '../contracts/agent.js';

export function toEntityReference(
  entity: Entity,
  reason?: string,
): AgentEntityReference {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    qualified_name: entity.qualified_name,
    file: entity.file,
    location: entity.location,
    language: entity.language,
    quality_score: entity.metrics?.quality_score,
    hotspot_score: entity.metrics?.hotspot_score,
    reason,
  };
}

export function toCycleReference(cycle: DetectedCycle): AgentCycleReference {
  return {
    id: cycle.id,
    granularity: cycle.granularity,
    severity: cycle.severity,
    entities: cycle.entities,
    relation_types: cycle.relation_types,
    length: cycle.length,
  };
}

export function toViolationReference(
  violation: ArchitectureViolation,
): AgentViolationReference {
  return {
    id: violation.id,
    rule: violation.rule === 'must_not_access' ? 'must_not_access' : 'may_only_access',
    layer_from: violation.layer_from,
    layer_to: violation.layer_to,
    entity_from: violation.entity_from,
    entity_to: violation.entity_to,
    relation_type: violation.relation_type,
    file: violation.location.file,
    line: violation.location.line,
    suggestion: violation.auto_fix_suggestion ?? 'Review architecture layering for this dependency',
  };
}

export function uniqueFiles(entities: AgentEntityReference[]): string[] {
  return [...new Set(entities.map((entity) => entity.file))].sort();
}
