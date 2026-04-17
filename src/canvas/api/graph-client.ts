/**
 * Graph API client — fetches entities, relations, and metadata from the Express graph server.
 * The API base URL is relative (proxied by Vite dev server to http://localhost:3001).
 *
 * Types are sourced from `src/contracts/` (single source of truth) and
 * re-exported here for canvas-local imports.
 */
export type {
  Entity,
  EntityKind,
  EntityMetrics,
  Location,
} from '../../contracts/entities.js';
export type { Relation, RelationType } from '../../contracts/relations.js';

import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';

const API_BASE = '/flowlens-api';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchEntities(): Promise<Entity[]> {
  return fetchJSON<Entity[]>('/entities');
}

export async function fetchRelations(): Promise<Relation[]> {
  return fetchJSON<Relation[]>('/relations');
}

export async function fetchArchitecture(): Promise<unknown> {
  return fetchJSON('/architecture');
}

export async function fetchAnnotations(): Promise<unknown[]> {
  const data = await fetchJSON<{ annotations?: unknown[] }>('/annotations');
  return data.annotations ?? [];
}

export async function fetchCycles(): Promise<unknown[]> {
  return fetchJSON<unknown[]>('/cycles');
}

export async function fetchViolations(): Promise<unknown[]> {
  return fetchJSON<unknown[]>('/violations');
}

export async function fetchDiff(sha: string): Promise<{ changes?: unknown[] }> {
  return fetchJSON<{ changes?: unknown[] }>(`/diff?sha=${encodeURIComponent(sha)}`);
}

export interface GraphSummary {
  entity_count: number;
  relation_count: number;
  entities_by_kind: Record<string, number>;
  relations_by_type: Record<string, number>;
}

export async function fetchSummary(): Promise<GraphSummary> {
  return fetchJSON<GraphSummary>('/summary');
}
