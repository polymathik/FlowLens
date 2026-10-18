/**
 * Graph API client for ONE project — the only canvas module that talks to
 * the graph routes. In the explorer the base is
 * `/api/projects/<id>/canvas` (served by the daemon); the standalone
 * server uses `/flowlens-api`. Components get the client of their project
 * tab from `GraphClientContext` (see `useGraphClient`).
 *
 * Types come from `src/contracts/` (single source of truth).
 */
export type { Entity, EntityKind, EntityMetrics, Location } from '../../contracts/entities.js';
export type { Relation, RelationType } from '../../contracts/relations.js';
export { ApiError } from './http.js';

import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import type { DetectedCycle } from '../../contracts/analysis/cycles.js';
import type { ArchitectureViolation } from '../../contracts/analysis/architecture.js';
import type { InterfaceDiff } from '../../contracts/analysis/diff.js';
import type {
  ArchitecturePreviewResponse,
  ArchitectureSaveResponse,
  CanvasHotspotsResponse,
  CanvasSummary,
  CanvasWorkspaceResponse,
} from '../../contracts/canvas/index.js';
import { ApiError, postJson, putJson, requestJson } from './http.js';
import { EMPTY_ZONE_OVERRIDES, type ZoneOverrides } from '../../contracts/zones.js';

export const LEGACY_API_BASE = '/flowlens-api';

export function projectApiBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/canvas`;
}

export function createGraphClient(base: string) {
  const get = <T>(path: string) => requestJson<T>(`${base}${path}`);
  return {
    base,
    fetchEntities: () => get<Entity[]>('/entities'),
    fetchRelations: () => get<Relation[]>('/relations'),
    fetchSummary: () => get<CanvasSummary>('/summary'),
    /** Workspace globs + manifests for package detection (Map v2); callers fall back when absent. */
    fetchWorkspace: () => get<CanvasWorkspaceResponse>('/workspace'),
    /** The user's zone overrides; a daemon without the route (404) means "none". */
    fetchZoneOverrides: async (): Promise<ZoneOverrides> => {
      try {
        return await get<ZoneOverrides>('/zones');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return EMPTY_ZONE_OVERRIDES;
        throw err;
      }
    },
    /** Validate and store the overrides; resolves with what the server stored. */
    putZoneOverrides: (overrides: ZoneOverrides) => putJson<ZoneOverrides>(`${base}/zones`, overrides),
    /** Runtime cycles; `includeTypeOnly` also counts type-only imports/annotations. */
    fetchCycles: (includeTypeOnly = false) =>
      get<DetectedCycle[]>(includeTypeOnly ? '/cycles?include_type_only=1' : '/cycles'),
    fetchViolations: () => get<ArchitectureViolation[]>('/violations'),
    fetchAnnotations: async (): Promise<unknown[]> => (await get<{ annotations?: unknown[] }>('/annotations')).annotations ?? [],
    fetchHotspots: (limit = 50) => get<CanvasHotspotsResponse>(`/hotspots?limit=${encodeURIComponent(String(limit))}`),
    fetchDiff: (sha: string) => get<InterfaceDiff>(`/diff?sha=${encodeURIComponent(sha)}`),
    /** Saved rules; `layers` is always present (empty when no file exists). */
    fetchArchitecture: () => get<Partial<ArchitectureConfig> & { layers: ArchitectureConfig['layers'] }>('/architecture'),
    /** Validate and save. Rejects with ApiError(400, issues) when invalid. */
    saveArchitecture: (config: unknown) => postJson<ArchitectureSaveResponse>(`${base}/architecture`, config),
    /** Validate a draft and compute its violations without saving. */
    previewArchitecture: (config: unknown, signal?: AbortSignal) =>
      postJson<ArchitecturePreviewResponse>(`${base}/architecture/preview`, config, signal),
  };
}

export type GraphClient = ReturnType<typeof createGraphClient>;
