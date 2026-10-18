/**
 * Graph quality contract (Phase 8).
 *
 * `computeGraphQuality(store)` measures how far the stored graph can be
 * trusted. The same numbers are printed after `flowlens init` / `index`,
 * written into `.flowlens/manifest.json` (as the `quality` extension field)
 * and asserted by the golden tests.
 */
import type { RelationType } from './relations.js';
import type { GraphManifest } from './manifest.js';

export interface ResolutionCounts {
  resolved: number;
  unresolved: number;
  ambiguous: number;
}

export interface GraphQuality {
  entity_count: number;
  /** Edges in the edge keyspace (resolved + direct). */
  edge_count: number;
  /** Edges whose `from` or `to` is not a stored entity. Target: 0. */
  dangling_edges: number;
  /** dangling_edges / edge_count (0 when there are no edges). Target < 1%. */
  dangling_ratio: number;
  /** Unresolved references, member-call leaves (`meta.receiver`) excluded. */
  unresolved_count: number;
  ambiguous_count: number;
  /**
   * Member calls (`recv.method()`) whose method could not be found on a project
   * receiver — kept as unresolved leaves for Flow, but not parse failures, so they
   * are counted apart (Parser truth 2, additive; absent in older manifests).
   */
  member_unresolved_count?: number;
  /** Unresolved + ambiguous counts per relation type. */
  unresolved_by_type: Partial<Record<RelationType, number>>;
  /** Unresolved + ambiguous counts per language of the source file. */
  unresolved_by_language: Record<string, number>;
  /** Cross-file (pass-2) outcomes per relation type. */
  resolution_by_type: Partial<Record<RelationType, ResolutionCounts>>;
  /** Entity ids seen more than once across files in the last run. Target: 0. */
  id_collisions: number;
  /** Same-file duplicate declarations merged by the parser (overloads, redefinitions). */
  duplicate_declarations: number;
  /** Relative (project-internal) import specifiers seen / resolved to a file. */
  relative_imports: number;
  relative_imports_resolved: number;
  /** relative_imports_resolved / relative_imports (1 when none). Target ≥ 0.98 for TS/JS. */
  import_resolution_rate: number;
  /** Files whose tree contained ERROR / MISSING nodes. */
  files_with_syntax_errors: number;
}

/** What the indexer writes to `.flowlens/manifest.json`: the shared manifest plus Phase 8 extensions. */
export interface IndexManifest extends GraphManifest {
  quality?: GraphQuality;
  /** Parser/extractor revision; bump when extraction output changes. */
  parser_version?: string;
}
