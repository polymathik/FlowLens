import type { EntityKind } from '../entities.js';

export type HotspotEntry = {
  entity_id: string;
  entity_name: string;
  entity_kind: EntityKind;
  file: string;
  hotspot_score: number;
  churn_rate: number;
  cognitive_complexity: number;
  dependent_count: number;
  /** Phase 10: qualified name for unambiguous follow-up calls. */
  qualified_name?: string;
  /** Phase 10: commits touching the file in the churn period. */
  change_count?: number;
  /** Phase 10: ISO date of the last commit touching the file ('' if unknown). */
  last_changed?: string;
};
