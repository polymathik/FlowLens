/**
 * REST client of the history routes (`HISTORY_ROUTES` in src/contracts/history.ts), relative to a
 * project's canvas API base (`GraphClient.base`). Kept apart from the graph client: the timeline is the
 * only consumer.
 */
import type { HistorySummary, HistoryTopology, TopologyBuildStarted, TopologyJobStatus } from '../../contracts/history.js';
import { ApiError, postJson, requestJson } from '../api/http';

export type HistoryFetch =
  | { kind: 'ok'; history: HistorySummary }
  | { kind: 'empty'; reason: 'not_a_git_repo' | 'no_commits'; message: string };

/** The newest commits of the project; `mainline` lists merges against their first parent (exact trees). */
export async function fetchHistory(base: string, mainline: boolean, signal?: AbortSignal): Promise<HistoryFetch> {
  try {
    const history = await requestJson<HistorySummary>(`${base}/history${mainline ? '?first_parent=1' : ''}`, { signal });
    return { kind: 'ok', history };
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'not_a_git_repo' || err.code === 'no_commits')) {
      return { kind: 'empty', reason: err.code, message: err.message };
    }
    throw err;
  }
}

/** Stored link history, or null when none was built yet (404 `not_built`). */
export async function fetchTopology(base: string, signal?: AbortSignal): Promise<HistoryTopology | null> {
  try {
    return await requestJson<HistoryTopology>(`${base}/history/topology`, { signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export const startTopologyBuild = (base: string, body: { every?: number; max?: number } = {}): Promise<TopologyBuildStarted> =>
  postJson<TopologyBuildStarted>(`${base}/history/topology/build`, body);

export const fetchTopologyStatus = (base: string, signal?: AbortSignal): Promise<TopologyJobStatus> =>
  requestJson<TopologyJobStatus>(`${base}/history/topology/status`, { signal });

export const cancelTopologyBuild = (base: string): Promise<TopologyJobStatus> => requestJson<TopologyJobStatus>(`${base}/history/topology/build`, { method: 'DELETE' });
