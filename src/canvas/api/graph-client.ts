/**
 * Graph API client — the only module in the canvas that talks HTTP.
 * Base URL is relative (`/flowlens-api`), proxied by the Vite dev server or
 * served same-origin in production.
 *
 * Types come from `src/contracts/` (single source of truth).
 */
export type { Entity, EntityKind, EntityMetrics, Location } from '../../contracts/entities.js';
export type { Relation, RelationType } from '../../contracts/relations.js';

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
  ConfigIssue,
} from '../../contracts/canvas/index.js';

export const API_BASE = '/flowlens-api';

/** HTTP error carrying the status and any validation issues from the server. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ConfigIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let issues: ConfigIssue[] = [];
    let message = `API ${path} returned ${res.status}: ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; issues?: ConfigIssue[] };
      if (Array.isArray(body.issues)) issues = body.issues;
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, issues);
  }
  return res.json() as Promise<T>;
}

function postJSON<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export const fetchEntities = () => request<Entity[]>('/entities');
export const fetchRelations = () => request<Relation[]>('/relations');
export const fetchSummary = () => request<CanvasSummary>('/summary');
export const fetchCycles = () => request<DetectedCycle[]>('/cycles');
export const fetchViolations = () => request<ArchitectureViolation[]>('/violations');

export async function fetchAnnotations(): Promise<unknown[]> {
  const data = await request<{ annotations?: unknown[] }>('/annotations');
  return data.annotations ?? [];
}

export const fetchHotspots = (limit = 50) =>
  request<CanvasHotspotsResponse>(`/hotspots?limit=${encodeURIComponent(String(limit))}`);

export const fetchDiff = (sha: string) =>
  request<InterfaceDiff>(`/diff?sha=${encodeURIComponent(sha)}`);

/** Saved rules; `layers` is always present (empty when no file exists). */
export const fetchArchitecture = () =>
  request<Partial<ArchitectureConfig> & { layers: ArchitectureConfig['layers'] }>('/architecture');

/** Validate and save. Rejects with ApiError(400, issues) when invalid. */
export const saveArchitecture = (config: unknown) =>
  postJSON<ArchitectureSaveResponse>('/architecture', config);

/** Validate a draft and compute its violations without saving. */
export const previewArchitecture = (config: unknown, signal?: AbortSignal) =>
  postJSON<ArchitecturePreviewResponse>('/architecture/preview', config, signal);

/** Server-sent events stream (watch mode pushes `graph-updated`). */
export function openEventStream(): EventSource {
  return new EventSource(`${API_BASE}/events`);
}
