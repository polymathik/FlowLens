/**
 * Graph manifest contract — `.flowlens/manifest.json`.
 *
 * One small file that says *which* graph a consumer is looking at and
 * whether it can be trusted: which project, which source revision, which
 * schema/parser produced it, and whether the last index run completed.
 * Every surface (MCP responses, canvas, agent hooks, reports) reads the
 * same manifest so freshness and identity are reported consistently.
 *
 * Owners: written by the indexer (Lane A / Phase 8); read by the graph
 * service (Lane B / Phase 9), MCP, canvas and agent hooks.
 */

/** Bump when the stored graph shape changes incompatibly. */
export const GRAPH_SCHEMA_VERSION = 2;

export type IndexCompletion = 'complete' | 'partial' | 'failed' | 'in_progress';

export interface IndexErrorSummary {
  /** Files that failed to parse and contributed no entities. */
  parse_failures: number;
  /** Relations whose target could not be resolved to an entity. */
  unresolved_relations: number;
  /** Relations whose target matched more than one candidate. */
  ambiguous_relations: number;
  /** Up to 20 failing file paths (relative), for diagnostics. */
  failed_files: string[];
}

export interface GraphManifest {
  /** Stable project identifier; matches ProjectRecord.id in the registry. */
  project_id: string;
  /** Absolute, canonical project root at the time of indexing. */
  root: string;
  schema_version: number;
  /** FlowLens package version that produced the graph. */
  flowlens_version: string;
  /** Git HEAD SHA at index time, or null when not a git repository. */
  git_head: string | null;
  /** True when the working tree had uncommitted changes at index time. */
  git_dirty: boolean;
  completion: IndexCompletion;
  /** ISO-8601 time the last index run started. */
  started_at: string;
  /** ISO-8601 time the last index run finished (null while in progress). */
  finished_at: string | null;
  file_count: number;
  entity_count: number;
  relation_count: number;
  errors: IndexErrorSummary;
}

/** Fields every graph-backed response should carry so clients know what answered them. */
export interface GraphIdentity {
  project_id: string;
  git_head: string | null;
  completion: IndexCompletion;
  last_indexed: string | null;
}

export interface ManifestStore {
  read(flowlensDir: string): Promise<GraphManifest | null>;
  write(flowlensDir: string, manifest: GraphManifest): Promise<void>;
}
