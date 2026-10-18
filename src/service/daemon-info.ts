/**
 * Daemon discovery files in `$FLOWLENS_HOME` — how clients find and
 * authenticate to a daemon. Each daemon writes
 * `daemon-p<protocol_key>.json` (mode 0600) once listening and removes it
 * on shutdown (only the daemon that wrote it). The key identifies a
 * compatible code base, so FlowLens versions never share — or stop — each
 * other's daemon (Phase 12 review H2). `daemon.json` is the legacy file of
 * older versions; it is only listed, never used to connect.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAEMON_INFO_FILE, DAEMON_INFO_PREFIX, GRAPH_RPC_PROTOCOL, SERVICE_PROTOCOL_REVISION, type DaemonInfo,
} from '../contracts/service.js';
import { writeJsonAtomic } from '../projects/atomic.js';
import { ensureFlowlensHome, flowlensHome } from '../projects/paths.js';
import { FLOWLENS_VERSION } from './runtime.js';

/** 12 hex chars of sha256(version, RPC protocol, service revision). */
export function protocolKey(
  version = FLOWLENS_VERSION, protocol = GRAPH_RPC_PROTOCOL, revision = SERVICE_PROTOCOL_REVISION,
): string {
  return createHash('sha256').update(`${version}\n${protocol}\n${revision}`).digest('hex').slice(0, 12);
}

export const OWN_PROTOCOL_KEY = protocolKey();

export function daemonInfoPath(key = OWN_PROTOCOL_KEY): string {
  return join(flowlensHome(), `${DAEMON_INFO_PREFIX}${key}.json`);
}

export function daemonLogPath(key = OWN_PROTOCOL_KEY): string {
  return join(flowlensHome(), `${DAEMON_INFO_PREFIX}${key}.log`);
}

export function daemonStartLockPath(key = OWN_PROTOCOL_KEY): string {
  return join(flowlensHome(), `${DAEMON_INFO_PREFIX}${key}.start.lock`);
}

function parseInfo(p: string): DaemonInfo | null {
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

/** This code base's daemon info (never another version's). */
export function readDaemonInfo(key = OWN_PROTOCOL_KEY): DaemonInfo | null {
  return parseInfo(daemonInfoPath(key));
}

export interface KnownDaemonFile {
  path: string;
  info: DaemonInfo;
  /** True for this code base's own key. */
  own: boolean;
  /** True for the pre-Phase-12 `daemon.json`. */
  legacy: boolean;
}

/** Every daemon info file in `$FLOWLENS_HOME` (own first), parsed. */
export function listDaemonInfoFiles(): KnownDaemonFile[] {
  let names: string[];
  try {
    names = readdirSync(flowlensHome());
  } catch {
    return [];
  }
  const out: KnownDaemonFile[] = [];
  for (const name of names) {
    const legacy = name === DAEMON_INFO_FILE;
    if (!legacy && !(name.startsWith(DAEMON_INFO_PREFIX) && name.endsWith('.json'))) continue;
    const path = join(flowlensHome(), name);
    const info = parseInfo(path);
    if (!info) continue;
    out.push({ path, info, own: path === daemonInfoPath(), legacy });
  }
  return out.sort((a, b) => Number(b.own) - Number(a.own));
}

export function writeDaemonInfo(info: DaemonInfo): void {
  ensureFlowlensHome();
  writeJsonAtomic(daemonInfoPath(info.protocol_key ?? OWN_PROTOCOL_KEY), info, 0o600);
}

/** Remove this key's info file if it still describes `pid`. */
export function removeDaemonInfo(pid: number, key = OWN_PROTOCOL_KEY): void {
  const cur = readDaemonInfo(key);
  if (cur && cur.pid !== pid) return;
  try { unlinkSync(daemonInfoPath(key)); } catch { /* already gone */ }
}

/** Remove a stale (dead-pid) info file of any key. */
export function removeInfoFile(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}
