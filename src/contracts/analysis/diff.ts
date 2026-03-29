import type { Entity } from '../entities.js';

export type DiffChangeType =
  | 'added' | 'removed' | 'modified' | 'visibility'
  | 'parameter_added' | 'parameter_removed'
  | 'type_changed' | 'return_changed';

export type DiffSeverity = 'breaking' | 'non-breaking';

export type InterfaceDiffEntry = {
  entity_id: string;
  entity_name: string;
  change_type: DiffChangeType;
  severity: DiffSeverity;
  affected_dependents: number;
  details: string;
  before?: Partial<Entity>;
  after?: Partial<Entity>;
};

export type InterfaceDiff = {
  from_sha: string;
  to_sha: string;
  changes: InterfaceDiffEntry[];
  summary: {
    total_changes: number;
    breaking_changes: number;
    non_breaking_changes: number;
    most_impacted_entity?: string;
  };
};
