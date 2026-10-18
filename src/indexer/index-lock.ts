/**
 * Cross-process per-project index lock (`<root>/.flowlens/index.lock`).
 * Held for a whole indexer run; heart-beats so a long full index is never
 * mistaken for a stale lock, while a crashed holder (dead pid, or no beat
 * for `INDEX_LOCK_STALE_MS`) is taken over. See contracts/indexer.ts.
 */
import { join } from 'node:path';
import {
  INDEX_LOCK_FILE, INDEX_LOCK_HEARTBEAT_MS, INDEX_LOCK_STALE_MS, INDEX_LOCK_TIMEOUT_MS,
} from '../contracts/indexer.js';
import { withFileLock } from '../projects/file-lock.js';

/** Override the wait timeout (ms) — tests and unusual setups. */
export const INDEX_LOCK_TIMEOUT_ENV = 'FLOWLENS_INDEX_LOCK_TIMEOUT_MS';

export function indexLockPath(flowlensDir: string): string {
  return join(flowlensDir, INDEX_LOCK_FILE);
}

export function withIndexLock<T>(
  flowlensDir: string,
  fn: () => Promise<T>,
  onWait?: (holderPid?: number) => void,
): Promise<T> {
  const env = Number(process.env[INDEX_LOCK_TIMEOUT_ENV]);
  const timeoutMs = Number.isFinite(env) && env > 0 ? env : INDEX_LOCK_TIMEOUT_MS;
  return withFileLock(indexLockPath(flowlensDir), fn, {
    staleMs: INDEX_LOCK_STALE_MS,
    heartbeatMs: INDEX_LOCK_HEARTBEAT_MS,
    timeoutMs,
    onWait: (holder) => onWait?.(holder.pid),
  });
}
