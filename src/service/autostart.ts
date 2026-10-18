/**
 * Find a running daemon or start one.
 *
 * 1. Read `daemon.json`; ping with its token. Same version and graph RPC
 *    protocol → use it; a different FlowLens version or RPC method set (a
 *    daemon still running older code) is asked to shut down and replaced.
 * 2. Otherwise, under a start lockfile (so concurrent CLIs spawn only one
 *    daemon), spawn `flowlens daemon start --foreground` detached with
 *    stdio to `daemon.log`, `windowsHide`, cwd = `$FLOWLENS_HOME` (never a
 *    project dir — Windows would pin it), `unref()` it, and poll until it
 *    answers or the timeout passes.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { GRAPH_RPC_PROTOCOL, type DaemonInfo } from '../contracts/service.js';
import { isPidAlive, withFileLock } from '../projects/file-lock.js';
import { ensureFlowlensHome } from '../projects/paths.js';
import { DaemonClient } from './client.js';
import { daemonLogPath, daemonStartLockPath, readDaemonInfo } from './daemon-info.js';
import { cliLaunch, FLOWLENS_VERSION } from './runtime.js';

export interface ConnectOptions {
  /** Start a daemon when none answers (default true). */
  autoStart?: boolean;
  /** How long to wait for a fresh daemon to answer (default 15 s). */
  timeoutMs?: number;
}

const LOG_MAX_BYTES = 5 * 1024 * 1024;

/** A live, same-version daemon, or null. Never spawns. */
export async function findDaemon(): Promise<DaemonClient | null> {
  const info = readDaemonInfo();
  if (!info) return null;
  const client = new DaemonClient(info);
  const pong = await client.ping();
  if (!pong) {
    client.destroy();
    return null;
  }
  if (pong.version !== FLOWLENS_VERSION || pong.protocol !== GRAPH_RPC_PROTOCOL) {
    await stopDaemon(client);
    return null;
  }
  return client;
}

export async function connectDaemon(o: ConnectOptions = {}): Promise<DaemonClient> {
  const found = await findDaemon();
  if (found) return found;
  if (o.autoStart === false) throw new Error('FlowLens daemon is not running (start it with "flowlens daemon start").');
  const timeoutMs = o.timeoutMs ?? 15_000;
  ensureFlowlensHome();
  return withFileLock(daemonStartLockPath(), async () => {
    const again = await findDaemon();
    if (again) return again;
    return spawnAndWait(timeoutMs);
  }, { staleMs: timeoutMs + 5_000, timeoutMs: timeoutMs + 10_000 });
}

/** Ask a daemon to shut down and wait for its process to exit. */
export async function stopDaemon(client: DaemonClient, timeoutMs = 10_000): Promise<boolean> {
  const pid = client.info.pid;
  try {
    await client.request('POST', '/api/shutdown', {}, { timeoutMs: 2_000 });
  } catch {
    if (isPidAlive(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    }
  }
  client.destroy();
  const deadline = Date.now() + timeoutMs;
  while (isPidAlive(pid) && Date.now() < deadline) await sleep(50);
  return !isPidAlive(pid);
}

function openLog(): number {
  const p = daemonLogPath();
  try {
    if (existsSync(p) && statSync(p).size > LOG_MAX_BYTES) truncateSync(p, 0);
  } catch { /* ignore */ }
  return openSync(p, 'a', 0o600);
}

function logTail(): string {
  try {
    return readFileSync(daemonLogPath(), 'utf8').split('\n').slice(-15).join('\n');
  } catch {
    return '';
  }
}

async function spawnAndWait(timeoutMs: number): Promise<DaemonClient> {
  const home = ensureFlowlensHome();
  const { command, args } = cliLaunch(['daemon', 'start', '--foreground']);
  const fd = openLog();
  let exitCode: number | null = null;
  const child = spawn(command, args, {
    cwd: home,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: process.env,
  });
  closeSync(fd);
  child.on('exit', (code) => { exitCode = code ?? -1; });
  child.on('error', () => { exitCode = -1; });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info: DaemonInfo | null = readDaemonInfo();
    if (info && isPidAlive(info.pid)) {
      const client = new DaemonClient(info);
      if (await client.ping(500)) return client;
      client.destroy();
    }
    if (exitCode !== null) {
      const raced = await findDaemon(); // another daemon won the race
      if (raced) return raced;
      throw new Error(`FlowLens daemon exited during start (code ${exitCode}).\n${logTail()}`);
    }
    await sleep(50);
  }
  throw new Error(`FlowLens daemon did not answer within ${timeoutMs} ms.\n${logTail()}`);
}
