/**
 * Register / remove the FlowLens MCP server for Claude Code.
 *
 *  - scope `local` (personal): `claude mcp add --transport stdio --scope local flowlens -- <cmd> serve` when the
 *    `claude` CLI is on PATH (the registration lives in Claude Code's private ~/.claude.json, which FlowLens
 *    never edits itself). Without the CLI: `.mcp.json` with an absolute path, kept out of git when we created it.
 *  - scope `shared`: the committed `.mcp.json`, portable `npx --no-install flowlens serve` when FlowLens is a
 *    devDependency of the project.
 */
import { existsSync } from 'node:fs';
import { FLOWLENS_MCP_SERVER_NAME, type AgentSetupScope, type McpInstallResult } from '../../contracts/agent-setup.js';
import { ensurePathIgnored } from '../git-exclude.js';
import {
  cliAdd, cliGet, cliRemove, realCliDeps, type CliDeps,
} from './claude-cli.js';
import { loadMcpJson, mcpJsonPath, removeFlowLensServer, writeFlowLensServer } from './mcp-json.js';
import { readClaudeLocalEntry } from './mcp-detect.js';
import { isOurServerEntry, resolveServeCommand } from './serve-command.js';
import { errorMessage, type McpUninstallOptions, type McpUninstallResult, type ServeCommand } from './types.js';

export interface ClaudeMcpOptions {
  projectDir: string;
  scope: AgentSetupScope;
  force?: boolean;
  /** Base command override (`--command`). */
  command?: string;
  deps?: CliDeps;
  /** Home directory (where ~/.claude.json lives); tests. */
  homeDir?: string;
}

const sameCommand = (a: { command: string; args: string[] }, b: ServeCommand): boolean =>
  a.command === b.command && JSON.stringify(a.args) === JSON.stringify(b.args);

export async function installClaudeMcp(options: ClaudeMcpOptions): Promise<McpInstallResult> {
  const cmd = resolveServeCommand(options.projectDir, { shared: options.scope === 'shared', command: options.command });
  if (options.scope === 'shared') return installProjectJson(options, cmd, 'shared');
  const deps = options.deps ?? realCliDeps;
  const claude = deps.which('claude');
  if (!claude) {
    const result = await installProjectJson(options, cmd, 'local');
    result.warnings = [
      'The "claude" CLI was not found on PATH, so FlowLens wrote .mcp.json in the project instead of registering the server in your personal Claude Code config.',
      ...(result.warnings ?? []),
    ];
    return result;
  }
  return installViaCli(options, cmd, claude, deps);
}

async function installViaCli(options: ClaudeMcpOptions, cmd: ServeCommand, claude: string, deps: CliDeps): Promise<McpInstallResult> {
  const cwd = options.projectDir;
  const base: McpInstallResult = { provider: 'claude-code', method: 'claude-cli', scope: 'local', changed: false, command: cmd.display };
  const previous = await readClaudeLocalEntry(cwd, options.homeDir);
  if (previous && sameCommand(previous, cmd) && !options.force) return base;

  if (previous) await cliRemove(claude, cwd, deps); // replace = remove, then add
  let added = await cliAdd(claude, cwd, cmd, deps);
  if (added.code !== 0 && !previous && /already exists/i.test(`${added.stdout}${added.stderr}`)) {
    await cliRemove(claude, cwd, deps);
    added = await cliAdd(claude, cwd, cmd, deps);
  }
  if (added.code !== 0) {
    if (previous) await cliAdd(claude, cwd, { ...cmd, command: previous.command, args: previous.args }, deps); // put the old entry back
    if (added.code === null) {
      // The CLI could not be run at all: fall back to the project file.
      const fallback = await installProjectJson(options, cmd, 'local');
      fallback.warnings = [`Could not run "claude" (${added.stderr.trim() || 'unknown error'}); wrote .mcp.json instead.`, ...(fallback.warnings ?? [])];
      return fallback;
    }
    throw new Error(`"claude mcp add" failed (exit ${added.code}): ${(added.stderr || added.stdout).trim()}${previous ? ' The previous registration was restored.' : ''}`);
  }
  const warnings = await verifyViaCli(claude, cwd, cmd, deps);
  return { ...base, changed: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** `claude mcp get flowlens` after adding: warnings only, the registration itself already succeeded. */
async function verifyViaCli(claude: string, cwd: string, cmd: ServeCommand, deps: CliDeps): Promise<string[]> {
  const got = await cliGet(claude, cwd, deps);
  if (!got || !got.found) return ['Registered, but "claude mcp get flowlens" could not confirm it; run it yourself to check.'];
  const warnings: string[] = [];
  if (got.command !== cmd.command || (got.args ?? '') !== cmd.args.join(' ')) {
    warnings.push(`"claude mcp get flowlens" reports a different command (${got.command} ${got.args ?? ''}) than the one registered.`);
  }
  if (!got.connected) {
    warnings.push(`Registered, but Claude Code could not start the server just now (${got.status ?? 'unknown status'}). Run "flowlens doctor", then "claude mcp get flowlens".`);
  }
  return warnings;
}

async function installProjectJson(options: ClaudeMcpOptions, cmd: ServeCommand, scope: AgentSetupScope): Promise<McpInstallResult> {
  const path = mcpJsonPath(options.projectDir);
  const result = await writeFlowLensServer(path, cmd, options.force ?? false);
  const warnings = [...cmd.warnings];
  if (result.foreign) {
    warnings.push(`${path} already has an MCP server named "${FLOWLENS_MCP_SERVER_NAME}" that does not start FlowLens; it was left unchanged (use --force to replace it).`);
  }
  if (scope === 'local') {
    warnings.push('The command in .mcp.json contains an absolute path on this machine, so it is for you only.');
    if (result.created) {
      const ignored = ensurePathIgnored(options.projectDir, '.mcp.json', 'personal MCP config (machine-specific path)');
      if (ignored.kind === 'failed') warnings.push(`Could not add .mcp.json to git's excludes (${ignored.message}); add it to .gitignore yourself.`);
    }
  }
  return {
    provider: 'claude-code', method: 'mcp-json', scope, path, changed: result.changed, command: cmd.display,
    ...(result.backup_path ? { backup_path: result.backup_path } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function uninstallClaudeMcp(projectDir: string, options: McpUninstallOptions = {}): Promise<McpUninstallResult> {
  const result: McpUninstallResult = { provider: 'claude-code', removed: [], backup_paths: [], warnings: [] };
  const scope = options.scope;
  if (scope !== 'shared') {
    const deps = options.deps ?? realCliDeps;
    const previous = await readClaudeLocalEntry(projectDir, options.homeDir);
    if (previous && isOurServerEntry(previous.command, previous.args)) {
      const claude = deps.which('claude');
      if (!claude) result.warnings.push('A FlowLens server is registered in your Claude Code config but the "claude" CLI was not found; run: claude mcp remove flowlens --scope local');
      else {
        const res = await cliRemove(claude, projectDir, deps);
        if (res.code === 0) result.removed.push('claude mcp remove flowlens --scope local');
        else result.warnings.push(`"claude mcp remove" failed: ${(res.stderr || res.stdout).trim()}`);
      }
    }
  }
  const path = mcpJsonPath(projectDir);
  if (existsSync(path)) {
    const loaded = await loadMcpJson(path); // invalid JSON → throws, nothing touched
    const entry = (loaded.data.mcpServers as Record<string, { command?: unknown; args?: unknown }> | undefined)?.[FLOWLENS_MCP_SERVER_NAME];
    const absolute = typeof entry?.command === 'string' && (entry.command.startsWith('/') || /^[A-Za-z]:/.test(entry.command)
      || (Array.isArray(entry.args) && entry.args.some((a) => typeof a === 'string' && (a.startsWith('/') || /^[A-Za-z]:/.test(a)))));
    const wanted = scope === undefined || scope === 'shared' || absolute; // `--local` only takes the machine-specific entry
    if (wanted) {
      try {
        const removed = await removeFlowLensServer(path);
        if (removed.removed) {
          result.removed.push(removed.file_deleted ? '.mcp.json (deleted, it only held FlowLens)' : '.mcp.json entry "flowlens"');
          if (removed.backup_path) result.backup_paths.push(removed.backup_path);
        }
      } catch (err) {
        result.warnings.push(errorMessage(err));
      }
    }
  }
  return result;
}
