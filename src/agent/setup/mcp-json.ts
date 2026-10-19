/**
 * Safe merge of the FlowLens server into a project `.mcp.json` (Claude Code's project-scoped MCP file).
 *
 * Same rules as the settings files (settings-file.ts): invalid JSON is never overwritten, other servers and
 * other top-level keys are preserved, a timestamped backup precedes any change, writes are atomic, and an
 * identical entry is a no-op (`changed: false`).
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FLOWLENS_MCP_SERVER_NAME } from '../../contracts/agent-setup.js';
import { backupFile, readTextIfExists, writeTextAtomic } from './file-safety.js';
import { isOurServerEntry } from './serve-command.js';
import { McpConfigError, errorMessage, type ServeCommand } from './types.js';

export type JsonObject = Record<string, unknown>;

export interface McpJsonEntry extends JsonObject {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export const mcpJsonPath = (projectDir: string): string => join(projectDir, '.mcp.json');

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface LoadedMcpJson {
  path: string;
  exists: boolean;
  data: JsonObject;
}

/** Parse `.mcp.json`; throws McpConfigError for unreadable, invalid JSON or an unexpected shape. */
export async function loadMcpJson(path: string): Promise<LoadedMcpJson> {
  const raw = await readTextIfExists(path);
  if (raw === null) return { path, exists: false, data: {} };
  if (raw.trim() === '') return { path, exists: true, data: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new McpConfigError('invalid_json', path, `${path} is not valid JSON (${errorMessage(err)}). FlowLens will not modify it; fix or move the file and retry.`);
  }
  if (!isObject(parsed)) throw new McpConfigError('invalid_shape', path, `${path} must contain a JSON object at the top level.`);
  if (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers)) {
    throw new McpConfigError('invalid_shape', path, `${path}: "mcpServers" must be an object keyed by server name; refusing to edit it.`);
  }
  return { path, exists: true, data: parsed };
}

export function desiredEntry(cmd: ServeCommand): McpJsonEntry {
  return { type: 'stdio', command: cmd.command, args: cmd.args };
}

/** Same server definition (ignores `env` and key order; a missing `type` means stdio). */
export function sameEntry(existing: unknown, wanted: McpJsonEntry): boolean {
  if (!isObject(existing)) return false;
  const type = existing.type ?? 'stdio';
  return type === wanted.type && existing.command === wanted.command
    && JSON.stringify(existing.args ?? []) === JSON.stringify(wanted.args ?? []);
}

export interface UpsertOutcome {
  changed: boolean;
  /** An entry named `flowlens` exists that does not start FlowLens; left alone unless forced. */
  foreign: boolean;
  previous?: unknown;
}

/** Insert/replace `mcpServers.flowlens` in `data` (mutates). User-added `env` on our entry is kept. */
export function upsertServer(data: JsonObject, wanted: McpJsonEntry, force: boolean): UpsertOutcome {
  const servers = isObject(data.mcpServers) ? data.mcpServers : (data.mcpServers = {}) as JsonObject;
  const existing = servers[FLOWLENS_MCP_SERVER_NAME];
  if (existing !== undefined && !force && sameEntry(existing, wanted)) return { changed: false, foreign: false, previous: existing };
  if (existing !== undefined && !isObject(existing)) return { changed: false, foreign: true, previous: existing };
  if (isObject(existing) && !isOurServerEntry(existing.command, existing.args) && !force) {
    return { changed: false, foreign: true, previous: existing };
  }
  const env = isObject(existing) && isObject(existing.env) ? { env: existing.env } : {};
  servers[FLOWLENS_MCP_SERVER_NAME] = { ...wanted, ...env };
  return { changed: true, foreign: false, previous: existing };
}

export interface WriteMcpJsonResult {
  changed: boolean;
  foreign: boolean;
  created: boolean;
  backup_path?: string;
}

/** Add (or refresh) the FlowLens server in `<path>`. Nothing is written for an identical entry. */
export async function writeFlowLensServer(path: string, cmd: ServeCommand, force: boolean): Promise<WriteMcpJsonResult> {
  const loaded = await loadMcpJson(path);
  const outcome = upsertServer(loaded.data, desiredEntry(cmd), force);
  if (!outcome.changed) return { changed: false, foreign: outcome.foreign, created: false };
  const backup = await backupFile(path);
  await writeTextAtomic(path, `${JSON.stringify(loaded.data, null, 2)}\n`);
  return { changed: true, foreign: false, created: !loaded.exists, ...(backup ? { backup_path: backup } : {}) };
}

export interface RemoveMcpJsonResult {
  removed: boolean;
  file_deleted: boolean;
  backup_path?: string;
}

/** Remove our entry only (never a differently-purposed server named flowlens); other servers stay. */
export async function removeFlowLensServer(path: string): Promise<RemoveMcpJsonResult> {
  const loaded = await loadMcpJson(path);
  const servers = isObject(loaded.data.mcpServers) ? loaded.data.mcpServers : {};
  const existing = servers[FLOWLENS_MCP_SERVER_NAME];
  if (!isObject(existing) || !isOurServerEntry(existing.command, existing.args)) return { removed: false, file_deleted: false };
  delete servers[FLOWLENS_MCP_SERVER_NAME];
  const onlyEmptyServers = Object.keys(loaded.data).every((k) => k === 'mcpServers') && Object.keys(servers).length === 0;
  if (onlyEmptyServers) {
    await rm(path, { force: true }); // nothing of the user's left in it: no backup needed
    return { removed: true, file_deleted: true };
  }
  const backup = await backupFile(path);
  await writeTextAtomic(path, `${JSON.stringify(loaded.data, null, 2)}\n`);
  return { removed: true, file_deleted: false, ...(backup ? { backup_path: backup } : {}) };
}
