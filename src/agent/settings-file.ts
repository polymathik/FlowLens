/**
 * Safe read/validate/backup/atomic-write for `.claude/settings.json` and
 * `.claude/settings.local.json`.
 *
 * Rules (audit §4.5 P0):
 * - Unparseable JSON is never overwritten: callers get a ClaudeSettingsError.
 * - Shapes we cannot safely edit (`hooks` not an object, an event value that is
 *   not an array, a group whose `hooks` is not an array) are refused, except
 *   `"hooks": null`, which is normalised to "no hooks" (nothing to lose).
 * - Before any modification a timestamped backup is written next to the file.
 * - Writes are atomic (tmp file in the same directory + rename), 2-space JSON.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ClaudeSettings, ClaudeSettingsErrorCode, ClaudeSettingsScope } from '../contracts/agent.js';

export class ClaudeSettingsError extends Error {
  constructor(
    readonly code: ClaudeSettingsErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeSettingsError';
  }
}

export interface LoadedSettings {
  path: string;
  exists: boolean;
  settings: ClaudeSettings;
}

/** `.claude/settings.json` (shared, committed). */
export function claudeSettingsPath(projectDir: string): string {
  return join(projectDir, '.claude', 'settings.json');
}

/** `.claude/settings.local.json` (personal; Claude Code applies it over settings.json). */
export function claudeLocalSettingsPath(projectDir: string): string {
  return join(projectDir, '.claude', 'settings.local.json');
}

export function claudeSettingsPathFor(projectDir: string, scope: ClaudeSettingsScope): string {
  return scope === 'shared' ? claudeSettingsPath(projectDir) : claudeLocalSettingsPath(projectDir);
}

export async function loadClaudeSettings(path: string): Promise<LoadedSettings> {
  if (!existsSync(path)) return { path, exists: false, settings: {} };
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    throw new ClaudeSettingsError('io', path, `Cannot read ${path}: ${errorMessage(err)}`);
  }
  if (raw.trim() === '') return { path, exists: true, settings: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClaudeSettingsError(
      'invalid_json',
      path,
      `${path} is not valid JSON (${errorMessage(err)}). FlowLens will not modify it; fix or move the file and retry.`,
    );
  }
  return { path, exists: true, settings: validateSettingsShape(parsed, path) };
}

/** Validate (and minimally normalise) the parts of settings FlowLens edits. */
export function validateSettingsShape(value: unknown, path: string): ClaudeSettings {
  if (!isPlainObject(value)) {
    throw new ClaudeSettingsError('invalid_shape', path, `${path} must contain a JSON object at the top level.`);
  }
  const settings = value as ClaudeSettings;
  if (settings.hooks === null) {
    delete settings.hooks;
    return settings;
  }
  if (settings.hooks === undefined) return settings;
  if (!isPlainObject(settings.hooks)) {
    throw new ClaudeSettingsError('invalid_shape', path, `${path}: "hooks" must be an object keyed by event name.`);
  }
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      throw new ClaudeSettingsError(
        'invalid_shape',
        path,
        `${path}: hooks.${event} must be an array of matcher groups; refusing to edit it.`,
      );
    }
    groups.forEach((group, index) => {
      if (!isPlainObject(group) || !Array.isArray((group as { hooks?: unknown }).hooks)) {
        throw new ClaudeSettingsError(
          'invalid_shape',
          path,
          `${path}: hooks.${event}[${index}] must be an object with a "hooks" array; refusing to edit it.`,
        );
      }
    });
  }
  return settings;
}

/** Copy the current file to `settings.json.flowlens-backup-<timestamp>`. */
export async function backupClaudeSettings(path: string, now = new Date()): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let backup = `${path}.flowlens-backup-${stamp}`;
  for (let n = 1; existsSync(backup); n++) backup = `${path}.flowlens-backup-${stamp}-${n}`;
  await copyFile(path, backup);
  return backup;
}

/** Atomically write settings as 2-space JSON (key order of the object is preserved). */
export async function writeClaudeSettingsAtomic(path: string, settings: ClaudeSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.flowlens-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new ClaudeSettingsError('io', path, `Cannot write ${path}: ${errorMessage(err)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
