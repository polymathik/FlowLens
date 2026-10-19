/** Atomic text writes and timestamped backups for config files FlowLens edits (shared by .mcp.json and config.toml). */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { McpConfigError, errorMessage } from './types.js';

export async function backupFile(path: string, now = new Date()): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let backup = `${path}.flowlens-backup-${stamp}`;
  for (let n = 1; existsSync(backup); n++) backup = `${path}.flowlens-backup-${stamp}-${n}`;
  await copyFile(path, backup);
  return backup;
}

export async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.flowlens-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, text, 'utf-8');
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new McpConfigError('io', path, `Cannot write ${path}: ${errorMessage(err)}`);
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    throw new McpConfigError('io', path, `Cannot read ${path}: ${errorMessage(err)}`);
  }
}
