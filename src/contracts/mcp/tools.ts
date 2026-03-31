import type { Entity, EntityKind, EntityMetrics } from '../entities.js';
import type { RelationType } from '../relations.js';
import type { DetectedCycle, CycleGranularity, CycleSeverity } from '../analysis/cycles.js';
import type { HotspotEntry } from '../analysis/hotspots.js';
import type { ArchitectureViolation } from '../analysis/architecture.js';
import type { InterfaceDiff, InterfaceDiffEntry } from '../analysis/diff.js';
import type { Annotation } from './annotations.js';

// get_context
export interface GetContextInput {
  entity: string;
  depth?: number;
  relation_types?: RelationType[];
  include_metrics?: boolean;
  max_results?: number;
}

export interface GetContextOutput {
  entity: Entity;
  relations: Array<{
    entity: Entity;
    relation_type: RelationType;
    direction: 'inbound' | 'outbound';
    depth: number;
  }>;
  metrics?: EntityMetrics;
  annotations?: Annotation[];
}

// get_dependents
export interface GetDependentsInput {
  entity: string;
  include_transitive?: boolean;
  relation_types?: RelationType[];
  max_results?: number;
}

export interface GetDependentsOutput {
  entity: Entity;
  dependents: Array<{
    entity: Entity;
    relation_type: RelationType;
    depth: number;
    location: { file: string; line: number; column: number };
  }>;
  risk_score: number;
  total_count: number;
}

// get_module_interface
export interface GetModuleInterfaceInput {
  module: string;
  diff_since?: string;
  max_results?: number;
}

export interface GetModuleInterfaceOutput {
  module: string;
  exports: Array<{
    entity: Entity;
    type_signature?: string;
    dependent_count: number;
    diff?: InterfaceDiffEntry;
  }>;
  last_snapshot_sha?: string;
}

// annotate
export interface AnnotateInput {
  entity: string;
  text: string;
  category: 'convention' | 'decision' | 'warning' | 'todo';
  author: string;
}

export interface AnnotateOutput {
  annotation_id: string;
  entity_id: string;
  created_at: string;
}

// traverse
export interface TraverseInput {
  start: string;
  direction: 'inbound' | 'outbound' | 'both';
  relation_types?: RelationType[];
  max_depth?: number;
  max_nodes?: number;
  stop_at_boundary?: boolean;
}

export interface TraverseOutput {
  start: Entity;
  nodes: Entity[];
  edges: Array<{ from: string; to: string; type: RelationType }>;
  stopped_at_boundaries?: string[];
}

// detect_cycles
export interface DetectCyclesInput {
  granularity?: CycleGranularity;
  scope?: string;
  relation_types?: RelationType[];
  severity_threshold?: CycleSeverity;
  max_results?: number;
}

export interface DetectCyclesOutput {
  cycles: DetectedCycle[];
  summary: {
    total_cycles: number;
    by_severity: { high: number; medium: number; low: number };
    by_granularity: Record<CycleGranularity, number>;
  };
}

// get_metrics
export interface GetMetricsInput {
  entity?: string;
  kind?: EntityKind;
  sort_by?: 'quality_score' | 'cognitive_complexity' | 'cyclomatic_complexity' | 'halstead_bugs' | 'instability' | 'hotspot_score';
  max_results?: number;
}

export interface GetMetricsOutput {
  entities: Array<{ entity: Entity; metrics: EntityMetrics }>;
  summary: {
    average_quality_score: number;
    highest_complexity_entity: string;
    estimated_bug_density: number;
    most_unstable_modules: string[];
  };
}

// diff_interface
export interface DiffInterfaceInput {
  since: string;
  scope?: string;
  breaking_only?: boolean;
  max_results?: number;
}

export interface DiffInterfaceOutput {
  diff: InterfaceDiff;
}

// check_architecture
export interface CheckArchitectureInput {
  scope?: string;
  max_results?: number;
}

export interface CheckArchitectureOutput {
  violations: ArchitectureViolation[];
  layers: Array<{
    name: string;
    entity_count: number;
    rules: { may_only_access?: string[]; must_not_access?: string[] };
  }>;
  summary: { total_violations: number; layers_with_violations: string[] };
}

// get_summary
export interface GetSummaryInput {}

export interface GetSummaryOutput {
  entities: Record<EntityKind, number>;
  relations: Record<RelationType, number>;
  languages: Record<string, { files: number; entities: number }>;
  top_modules: Array<{ path: string; entity_count: number }>;
  average_quality_score: number;
  layers: Array<{ name: string; entity_count: number }>;
  cycle_count: number;
  last_indexed: string;
}

// get_hotspots
export interface GetHotspotsInput {
  kind?: EntityKind;
  min_score?: number;
  max_results?: number;
}

export interface GetHotspotsOutput {
  hotspots: HotspotEntry[];
  summary: { total_hotspots: number; average_score: number; highest_score_entity: string };
}

// get_layer_map
export interface GetLayerMapInput {}

export interface GetLayerMapOutput {
  version: number;
  inferred_by: string;
  layers: Array<{
    name: string;
    include: { patterns?: string[]; files?: string[]; entities?: string[] };
    may_only_access?: string[];
    must_not_access?: string[];
    entity_count: number;
    violations: number;
  }>;
}
