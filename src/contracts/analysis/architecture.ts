import type { RelationType } from '../relations.js';

export type ArchitectureViolation = {
  id: string;
  rule: string;
  layer_from: string;
  layer_to: string;
  entity_from: string;
  entity_to: string;
  relation_type: RelationType;
  location: {
    file: string;
    line: number;
    column: number;
  };
  auto_fix_suggestion?: string;
};
