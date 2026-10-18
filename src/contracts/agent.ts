import type { EntityKind, Location } from './entities.js';
import type { RelationType } from './relations.js';
import type { CycleGranularity, CycleSeverity } from './analysis/cycles.js';

export type AgentEvent =
  | 'session_start'
  | 'prompt_submit'
  | 'pre_edit'
  | 'post_edit'
  | 'pre_commit'
  | 'stop'
  | 'compact';

export type AgentOutputFormat = 'markdown' | 'json';
export type AgentRisk = 'none' | 'low' | 'medium' | 'high';
export type AgentProvider = 'claude-code';
export type AgentChangedSource = 'argument' | 'hook' | 'git' | 'none';

export interface AgentContextRequest {
  event: AgentEvent;
  prompt?: string;
  changed_files?: string[];
  max_items?: number;
}

export interface AgentEntityReference {
  id: string;
  kind: EntityKind;
  name: string;
  qualified_name: string;
  file: string;
  location: Location;
  language: string;
  quality_score?: number;
  hotspot_score?: number;
  reason?: string;
}

export interface AgentCycleReference {
  id: string;
  granularity: CycleGranularity;
  severity: CycleSeverity;
  entities: string[];
  relation_types: RelationType[];
  length: number;
}

export interface AgentViolationReference {
  id: string;
  rule: 'may_only_access' | 'must_not_access';
  layer_from: string;
  layer_to: string;
  entity_from: string;
  entity_to: string;
  relation_type: RelationType;
  file: string;
  line: number;
  suggestion: string;
}

export interface AgentImpactReference {
  entity: AgentEntityReference;
  inbound_count: number;
  outbound_count: number;
}

export interface AgentContextPacket {
  generated_at: string;
  event: AgentEvent;
  summary: {
    entity_count: number;
    relation_count: number;
    languages: Record<string, number>;
  };
  relevant_files: string[];
  relevant_entities: AgentEntityReference[];
  hotspots: AgentEntityReference[];
  cycles: AgentCycleReference[];
  architecture_violations: AgentViolationReference[];
  guidance: string[];
}

export interface AgentGuardRequest {
  changed_files: string[];
  changed_source?: AgentChangedSource;
  strict?: boolean;
  max_items?: number;
}

export interface AgentReindexSummary {
  files_reparsed: number;
  files_deleted: number;
  entities_updated: number;
  relations_updated: number;
  errors: Array<{ path: string; message: string }>;
  duration_ms: number;
}

export interface AgentGuardReport {
  generated_at: string;
  changed_files: string[];
  changed_source: AgentChangedSource;
  risk: AgentRisk;
  reindex?: AgentReindexSummary;
  cycles: AgentCycleReference[];
  architecture_violations: AgentViolationReference[];
  impacted_entities: AgentImpactReference[];
  guidance: string[];
}

export interface ClaudeCodeHookInstallOptions {
  project_dir: string;
  command?: string;
  force?: boolean;
}

export interface AgentInstallResult {
  provider: AgentProvider;
  settings_path: string;
  hooks_added: number;
  hooks_existing: number;
}

export interface AgentUninstallResult {
  provider: AgentProvider;
  settings_path: string;
  hooks_removed: number;
}
