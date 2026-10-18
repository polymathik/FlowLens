/**
 * Canvas HTTP API contract — request/response shapes of the graph server
 * (`src/canvas/api/graph-server.ts`) consumed by `src/canvas/api/graph-client.ts`.
 *
 * All routes live under `/flowlens-api`. Wave 2 namespaces them by project
 * (`/api/projects/:projectId/...`, audit §6.1); the payloads stay the same.
 */
import type { EntityKind } from '../entities.js';
import type { ArchitectureViolation } from '../analysis/architecture.js';
import type { WorkspaceInfo } from '../hierarchy.js';

/** GET /flowlens-api/summary */
export interface CanvasSummary {
  /** Distinct source files with at least one indexed entity. */
  file_count: number;
  entity_count: number;
  relation_count: number;
  /** File-level dependency cycles. */
  cycle_count: number;
  /** Violations of the saved architecture rules (0 when no rules exist). */
  violation_count: number;
  /** ISO time of the last completed index (manifest, else graph dir mtime). */
  last_indexed: string | null;
  entities_by_kind: Record<string, number>;
  relations_by_type: Record<string, number>;
}

/** One row of GET /flowlens-api/hotspots (read from stored entity metrics). */
export interface CanvasHotspot {
  entity_id: string;
  entity_name: string;
  entity_kind: EntityKind;
  file: string;
  hotspot_score: number;
  churn_rate: number;
  cognitive_complexity: number;
  dependent_count: number;
}

/** GET /flowlens-api/hotspots?limit=N */
export interface CanvasHotspotsResponse {
  hotspots: CanvasHotspot[];
  /** Entities with a non-zero hotspot score before the limit was applied. */
  total: number;
}

/** One validation problem in a POSTed architecture config. */
export interface ConfigIssue {
  /** Dotted path into the config, e.g. "layers.1.may_only_access.0". */
  path: string;
  message: string;
}

/** 400 body for POST /architecture and /architecture/preview. */
export interface ConfigValidationError {
  error: 'invalid_architecture_config';
  issues: ConfigIssue[];
}

/** 200 body for POST /flowlens-api/architecture/preview (validates, never saves). */
export interface ArchitecturePreviewResponse {
  violations: ArchitectureViolation[];
  count: number;
}

/** 200 body for POST /flowlens-api/architecture. */
export interface ArchitectureSaveResponse {
  ok: true;
  violation_count: number;
}

/**
 * GET /flowlens-api/workspace (Map v2, additive) — workspace facts read from
 * the project root: pnpm-workspace.yaml / package.json `workspaces` globs and
 * every manifest (package.json, pyproject.toml, Cargo.toml, go.mod) among the
 * indexed files with its name. The canvas selects packages from it
 * (`selectPackages`); when the route is missing it falls back to manifests
 * inferred from the entity list.
 */
export type CanvasWorkspaceResponse = WorkspaceInfo;
