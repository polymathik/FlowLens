/**
 * Every FlowLens daemon known in `$FLOWLENS_HOME` — this code base's own,
 * other versions' (`daemon-p<key>.json`) and the legacy `daemon.json` —
 * with liveness, compatibility and live lease counts. Used by
 * `flowlens daemon status|stop` (Phase 12 review H2).
 */
import type { DaemonInfo, PingResponse, ProjectDetail } from '../contracts/service.js';
import { isPidAlive } from '../projects/file-lock.js';
import { isCompatiblePong, stopDaemon } from './autostart.js';
import { DaemonClient } from './client.js';
import { listDaemonInfoFiles, removeInfoFile } from './daemon-info.js';

export interface KnownDaemon {
  path: string;
  info: DaemonInfo;
  own: boolean;
  legacy: boolean;
  /** Answered a ping with its token. */
  alive: boolean;
  /** Same version + protocol as this CLI (only the own key can be). */
  compatible: boolean;
  pong: PingResponse | null;
  /** Registered projects with their graph state (null when unreachable). */
  projects: ProjectDetail[] | null;
  /** Sum of live leases over all projects (null when unknown). */
  leases: number | null;
}

export async function listKnownDaemons(timeoutMs = 1000): Promise<KnownDaemon[]> {
  return Promise.all(listDaemonInfoFiles().map(async (f) => {
    const client = new DaemonClient(f.info);
    try {
      const pong = await client.ping(timeoutMs);
      let projects: ProjectDetail[] | null = null;
      if (pong) {
        projects = await client.request<ProjectDetail[]>('GET', '/api/projects', undefined, { timeoutMs: 5_000 }).catch(() => null);
      }
      return {
        ...f,
        alive: pong !== null,
        compatible: f.own && pong !== null && isCompatiblePong(pong),
        pong,
        projects,
        leases: projects ? projects.reduce((n, p) => n + (p.graph?.leases ?? 0), 0) : null,
      };
    } finally {
      client.destroy();
    }
  }));
}

export interface StopOutcome {
  daemon: KnownDaemon;
  result: 'stopped' | 'timeout' | 'skipped_in_use' | 'removed_stale';
}

/**
 * Stop known daemons. The own daemon is always stopped; another version's
 * daemon only when `all` is set and it has no live leases (or `force`).
 * Info files of dead daemons are removed.
 */
export async function stopKnownDaemons(o: { all: boolean; force?: boolean }): Promise<StopOutcome[]> {
  const out: StopOutcome[] = [];
  for (const d of await listKnownDaemons()) {
    if (!d.own && !o.all) continue;
    if (!d.alive) {
      if (!isPidAlive(d.info.pid)) {
        removeInfoFile(d.path);
        out.push({ daemon: d, result: 'removed_stale' });
      }
      continue;
    }
    if (!d.own && !o.force && (d.leases === null || d.leases > 0)) {
      out.push({ daemon: d, result: 'skipped_in_use' });
      continue;
    }
    const stopped = await stopDaemon(new DaemonClient(d.info));
    out.push({ daemon: d, result: stopped ? 'stopped' : 'timeout' });
  }
  return out;
}
