/**
 * `$FLOWLENS_HOME/daemon.json` — how clients find and authenticate to the
 * daemon. Written with mode 0600 after the server is listening; removed on
 * shutdown (only by the daemon that wrote it).
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_INFO_FILE, DAEMON_LOG_FILE, type DaemonInfo } from '../contracts/service.js';
import { writeJsonAtomic } from '../projects/atomic.js';
import { ensureFlowlensHome, flowlensHome } from '../projects/paths.js';

export function daemonInfoPath(): string {
  return join(flowlensHome(), DAEMON_INFO_FILE);
}

export function daemonLogPath(): string {
  return join(flowlensHome(), DAEMON_LOG_FILE);
}

export function daemonStartLockPath(): string {
  return join(flowlensHome(), 'daemon.start.lock');
}

export function readDaemonInfo(): DaemonInfo | null {
  const p = daemonInfoPath();
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as Partial<DaemonInfo>;
    if (typeof v.port !== 'number' || typeof v.token !== 'string' || typeof v.pid !== 'number') {
      return null;
    }
    return v as DaemonInfo;
  } catch {
    return null;
  }
}

export function writeDaemonInfo(info: DaemonInfo): void {
  ensureFlowlensHome();
  writeJsonAtomic(daemonInfoPath(), info, 0o600);
}

/** Remove daemon.json if it still describes `pid`. */
export function removeDaemonInfo(pid: number): void {
  const cur = readDaemonInfo();
  if (cur && cur.pid !== pid) return;
  try { unlinkSync(daemonInfoPath()); } catch { /* already gone */ }
}
