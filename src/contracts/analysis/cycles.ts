import type { RelationType } from '../relations.js';

export type CycleGranularity = 'file' | 'module' | 'function' | 'all';
export type CycleSeverity = 'low' | 'medium' | 'high';

export const CYCLE_SEVERITIES: readonly CycleSeverity[] = ['low', 'medium', 'high'];

/** One hop of an ordered cycle path. */
export type CycleEdge = {
  from: string;
  to: string;
  relation_types: RelationType[];
};

export type DetectedCycle = {
  /** Deterministic hash of the sorted member ids. */
  id: string;
  /**
   * All members of the strongly connected component. Since Phase 10 the members
   * on `path` come first, in path order; remaining members follow sorted.
   * File granularity: file paths. Module: directory paths. Function/all: entity ids.
   */
  entities: string[];
  granularity: CycleGranularity;
  severity: CycleSeverity;
  relation_types: RelationType[];
  /** Number of members in the strongly connected component. */
  length: number;
  /** Phase 10: an actual closed cycle through the SCC, first node repeated at the end. */
  path?: string[];
  /** Phase 10: human-readable labels for `path` (qualified names for entity ids). */
  path_labels?: string[];
  /** Phase 10: the edge sequence along `path`. */
  edges?: CycleEdge[];
  /** Phase 10: why the severity was assigned (layers crossed, criticality, ...). */
  severity_reasons?: string[];
  /** Phase 10: architecture layers touched by the cycle members. */
  layers?: string[];
};
