import type { RelationType } from '../relations.js';

export type CycleGranularity = 'file' | 'module' | 'function' | 'all';
export type CycleSeverity = 'low' | 'medium' | 'high';

export type DetectedCycle = {
  id: string;
  entities: string[];
  granularity: CycleGranularity;
  severity: CycleSeverity;
  relation_types: RelationType[];
  length: number;
};
