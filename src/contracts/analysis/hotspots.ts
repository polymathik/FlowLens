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
};
