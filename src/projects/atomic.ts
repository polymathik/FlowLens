/**
 * Atomic file writes: write a sibling temp file, fsync, rename over the
 * target. rename(2) is atomic on POSIX; on Windows Node uses
 * MoveFileEx(REPLACE_EXISTING), which is atomic for same-volume files.
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export function writeFileAtomic(path: string, data: string, mode = 0o644): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function writeJsonAtomic(path: string, value: unknown, mode = 0o644): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}
