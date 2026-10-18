/**
 * Atomic file writes: write a sibling temp file, fsync, rename over the
 * target. rename(2) is atomic on POSIX; on Windows Node uses
 * MoveFileEx(REPLACE_EXISTING), which is atomic for same-volume files.
 */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';

function tmpPath(path: string): string {
  return `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
}

export function writeFileAtomic(path: string, data: string, mode = 0o644): void {
  const tmp = tmpPath(path);
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

/** Async `writeFileAtomic` (large files: does not block the event loop while writing). */
export async function writeFileAtomicAsync(path: string, data: string, mode = 0o644): Promise<void> {
  const tmp = tmpPath(path);
  const fh = await open(tmp, 'w', mode);
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}
