/**
 * Is the FlowLens MCP server connected for an agent in this project? Read-only, fast, never throws: the edit
 * gate calls it on its hot path (a hook process per edit).
 *
 * Claude Code: `<project>/.mcp.json`, and best-effort `~/.claude.json` (`projects[<abs path>].mcpServers` for
 * local scope, top-level `mcpServers` for user scope; the file is private to Claude Code and only read).
 * Codex: `<project>/.codex/config.toml`, and `~/.codex/config.toml` read-only.
 * `unknown` means the agent's own config could not be read, never "probably not".
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLOWLENS_MCP_SERVER_NAME, type AgentProviderId } from '../../contracts/agent-setup.js';
import { scanCodexToml } from './codex-block.js';
import { looksLikeFlowLens } from './serve-command.js';

export interface McpDetection {
  state: 'connected' | 'not_connected' | 'unknown';
  /** Where the entry was found (or why it is off), e.g. `.mcp.json`, `~/.claude.json (local scope)`. */
  via?: string;
}

export interface DetectOptions {
  /** Home directory override (tests). */
  homeDir?: string;
}

/**
 * Claude Code's private user/local config. `CLAUDE_CONFIG_DIR` relocates it (`$CLAUDE_CONFIG_DIR/.claude.json`);
 * an explicit `homeDir` (tests) always wins so a test never reads the developer's real config.
 */
export function claudeJsonPath(homeDir?: string): string {
  if (homeDir === undefined && process.env.CLAUDE_CONFIG_DIR) return join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
  return join(homeDir ?? homedir(), '.claude.json');
}

/** Skip absurdly large files rather than stall a hook. */
const MAX_BYTES = 64 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

async function readJson(path: string): Promise<Json | 'absent' | 'unreadable'> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return 'unreadable';
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
    return isObject(parsed) ? parsed : 'unreadable';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';
  }
}

/** Server entries of an `mcpServers` object that start FlowLens. */
export function flowlensServerNames(servers: unknown): string[] {
  if (!isObject(servers)) return [];
  return Object.entries(servers)
    .filter(([name, def]) => name === FLOWLENS_MCP_SERVER_NAME || (isObject(def) && looksLikeFlowLens(def.command, def.args)))
    .map(([name]) => name);
}

async function detectClaude(projectDir: string, home: string | undefined): Promise<McpDetection> {
  const project = resolve(projectDir);
  const mcpJson = await readJson(join(project, '.mcp.json'));
  const userCfg = await readJson(claudeJsonPath(home));
  const entry = isObject(userCfg) && isObject(userCfg.projects) && isObject(userCfg.projects[project])
    ? userCfg.projects[project] as Json : undefined;

  const projectNames = isObject(mcpJson) ? flowlensServerNames(mcpJson.mcpServers) : [];
  if (projectNames.length > 0) {
    const disabled = Array.isArray(entry?.disabledMcpjsonServers) && projectNames.every((n) => (entry?.disabledMcpjsonServers as unknown[]).includes(n));
    return disabled ? { state: 'not_connected', via: '.mcp.json (server disabled in Claude Code)' } : { state: 'connected', via: '.mcp.json' };
  }
  if (entry && flowlensServerNames(entry.mcpServers).length > 0) return { state: 'connected', via: '~/.claude.json (local scope)' };
  if (isObject(userCfg) && flowlensServerNames(userCfg.mcpServers).length > 0) return { state: 'connected', via: '~/.claude.json (user scope)' };
  // Nothing found: only a readable ~/.claude.json lets us say "not connected" (it holds local and user scope).
  return isObject(userCfg) ? { state: 'not_connected' } : { state: 'unknown' };
}

async function readText(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return null;
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function detectCodex(projectDir: string, home: string): Promise<McpDetection> {
  const sources: Array<[string, string]> = [
    [join(resolve(projectDir), '.codex', 'config.toml'), '.codex/config.toml'],
    [join(home, '.codex', 'config.toml'), '~/.codex/config.toml'],
  ];
  for (const [path, label] of sources) {
    const text = await readText(path);
    if (text === null) continue;
    const found = scanCodexToml(text);
    if (found.servers.length === 0) continue;
    return found.servers.some((s) => !s.disabled)
      ? { state: 'connected', via: label }
      : { state: 'not_connected', via: `${label} (server disabled)` };
  }
  return { state: 'not_connected' };
}

export async function detectMcpConnection(projectDir: string, provider: AgentProviderId, options: DetectOptions = {}): Promise<McpDetection> {
  try {
    return provider === 'claude-code'
      ? await detectClaude(projectDir, options.homeDir)
      : await detectCodex(projectDir, options.homeDir ?? homedir());
  } catch {
    return { state: 'unknown' };
  }
}

/** Entry for a FlowLens local-scope server in `~/.claude.json` (used to restore it if a refresh fails). */
export async function readClaudeLocalEntry(projectDir: string, home?: string): Promise<{ command: string; args: string[] } | null> {
  const cfg = await readJson(claudeJsonPath(home));
  if (!isObject(cfg) || !isObject(cfg.projects)) return null;
  const entry = cfg.projects[resolve(projectDir)];
  const server = isObject(entry) && isObject(entry.mcpServers) ? entry.mcpServers[FLOWLENS_MCP_SERVER_NAME] : undefined;
  if (!isObject(server) || typeof server.command !== 'string') return null;
  return { command: server.command, args: Array.isArray(server.args) ? server.args.filter((a): a is string => typeof a === 'string') : [] };
}
