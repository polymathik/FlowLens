/**
 * Explorer API client: session, project list, removal, health.
 * Routes: `src/contracts/canvas/explorer.ts`.
 */
import type { ProjectDetail } from '../../contracts/service.js';
import type { HealthReport } from '../../contracts/health.js';
import type { ExplorerHealthSummary, HealthReportFormat, SessionResponse } from '../../contracts/canvas/index.js';
import { requestJson } from './http.js';

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const fetchSession = () => requestJson<SessionResponse>('/api/session');
export const fetchProjects = () => requestJson<ProjectDetail[]>('/api/projects');
export const fetchHealth = (id: string) => requestJson<HealthReport>(`${p(id)}/health`);
export const fetchHealthSummary = (id: string) => requestJson<ExplorerHealthSummary>(`${p(id)}/health/summary`);
/** `force` removes it even while clients hold leases (otherwise 409 project_in_use). */
export const removeProject = (id: string, force = false) =>
  requestJson<{ ok: true; removed: boolean }>(`${p(id)}${force ? '?force=1' : ''}`, { method: 'DELETE' });
export const reportUrl = (id: string, format: HealthReportFormat) => `${p(id)}/health/report?format=${format}`;

/** Per-project SSE (`graph-changed`, `hello`). */
export const openProjectEvents = (id: string) => new EventSource(`${p(id)}/events`);
