import type { RelationType } from '../relations.js';

export type CycleGranularity = 'file' | 'module' | 'function' | 'all';
export type CycleSeverity = 'low' | 'medium' | 'high';

export const CYCLE_SEVERITIES: readonly CycleSeverity[] = ['low', 'medium', 'high'];

/** One hop of an ordered cycle path. */
export type CycleEdge = {
  from: string;
  to: string;
  relation_types: RelationType[];
  /**
   * Phase 12: every relation on this hop is type-level (type-only import,
   * type annotation, or a reference to an interface/type alias). Only set when
   * cycles were detected with `include_type_only`.
   */
  type_only?: boolean;
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
  /**
   * Phase 12: true when this loop exists only because type-level edges were
   * counted (no runtime cycle has exactly these members). Only set when cycles
   * were detected with `include_type_only`; runtime-only detection (the
   * default) never reports such loops.
   */
  type_only?: boolean;
};
