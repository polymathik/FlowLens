/**
 * Minimal cross-process lock: `open(path, 'wx')` (O_CREAT|O_EXCL) on a
 * lockfile holding `{pid, at}`. A lock is stale when its owner pid is dead
 * or it is older than `staleMs` (holders only keep it for milliseconds).
 * Waiters retry with jittered backoff until `timeoutMs`.
 */
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export interface FileLockOptions {
  staleMs?: number;
  timeoutMs?: number;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but owned by someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isStale(lockPath: string, staleMs: number): boolean {
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    if (age > staleMs) return true;
    const { pid } = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number };
    return typeof pid === 'number' && !isPidAlive(pid);
  } catch {
    // Unreadable/half-written lock: treat as stale only once it is old enough.
    try { return Date.now() - statSync(lockPath).mtimeMs > 1000; } catch { return false; }
  }
}

function tryAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  opts: FileLockOptions = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? 10_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  let delay = 5;
  while (!tryAcquire(lockPath)) {
    if (isStale(lockPath, staleMs)) {
      try { unlinkSync(lockPath); } catch { /* another waiter removed it */ }
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lockPath}`);
    await sleep(delay + Math.floor(Math.random() * delay));
    delay = Math.min(delay * 2, 100);
  }
  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}
