/**
 * Graph revision from the FlowLens daemon (Phase 12), for the digest cache.
 *
 * While the daemon holds a project's DB open, every write goes through it
 * (LevelDB allows one process) and bumps `ProjectGraphState.revision`, so
 * `daemon pid + started_at + open_since + revision` identifies the graph
 * content exactly — unlike the LevelDB stat fingerprint, it does not move on
 * background compaction. When there is no daemon, the DB is closed, or the
 * call fails/times out, this returns null and callers fall back to the stat
 * fingerprint. Never starts a daemon.
 */
import type { ProjectDetail } from '../contracts/service.js';
import { DaemonClient } from '../service/client.js';
import { readDaemonInfo } from '../service/daemon-info.js';
import { daemonDisabled } from '../service/open-graph-store.js';
import { readProjectIdentity } from '../utils/project-identity.js';

const TIMEOUT_MS = 400;

export async function serviceRevision(flowlensDir: string, o: { daemon?: boolean } = {}): Promise<string | null> {
  if (daemonDisabled(o)) return null;
  const id = readProjectIdentity(flowlensDir)?.id;
  const info = readDaemonInfo();
  if (!id || !info) return null;
  const client = new DaemonClient(info);
  try {
    const detail = await client.request<ProjectDetail>(
      'GET', `/api/projects/${encodeURIComponent(id)}`, undefined, { timeoutMs: TIMEOUT_MS },
    );
    const g = detail?.graph;
    if (!g?.open || !g.open_since || typeof g.revision !== 'number') return null;
    return `svc:${info.pid}:${info.started_at}:${g.open_since}:${g.revision}`;
  } catch {
    return null;
  } finally {
    client.destroy();
  }
}
