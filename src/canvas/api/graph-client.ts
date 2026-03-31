/**
 * Graph API client — fetches entities, relations, and metadata from the Express graph server.
 * The API base URL is relative (proxied by Vite dev server to http://localhost:3001).
 */

// Canvas-local type definitions mirroring backend contracts.
// Duplicated here because canvas has its own build system (Vite, not tsc).

export type EntityKind =
  | 'file' | 'module' | 'namespace' | 'class' | 'interface'
  | 'function' | 'method' | 'variable' | 'field' | 'parameter'
  | 'type' | 'enum' | 'enum_member' | 'decorator';

export type Location = {
  line_start: number;
  line_end: number;
  column_start: number;
  column_end: number;
};

export type EntityMetrics = {
  line_count: number;
  cognitive_complexity?: number;
  quality_score?: number;
  [key: string]: number | undefined;
};

export type Entity = {
  id: string;
  kind: EntityKind;
  name: string;
  qualified_name: string;
  file: string;
  location: Location;
  visibility: string;
  language: string;
  metrics?: EntityMetrics;
  annotations?: Record<string, string>;
};

export type RelationType =
  | 'import' | 'call' | 'extend' | 'implement'
  | 'override' | 'mixin' | 'use' | 'contain' | 'create'
  | 'parameter' | 'return' | 'throw' | 'decorate';

export type Relation = {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  location: { file: string; line: number; column: number };
  weight: number;
  confidence: number;
};

const API_BASE = '/api';

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
