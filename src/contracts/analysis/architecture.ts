import type { RelationType } from '../relations.js';

export type ArchitectureViolation = {
  id: string;
  /** Rule kind: 'may_only_access' | 'must_not_access'. */
  rule: string;
  layer_from: string;
  layer_to: string;
  /** Entity ids. */
  entity_from: string;
  entity_to: string;
  relation_type: RelationType;
  location: {
    file: string;
    line: number;
    column: number;
  };
  auto_fix_suggestion?: string;
  /** Phase 10: full human-readable rule, e.g. "Layer 'mcp' must not access 'cli'". */
  rule_text?: string;
  /** Phase 10: qualified names of the two entities. */
  entity_from_name?: string;
  entity_to_name?: string;
};
