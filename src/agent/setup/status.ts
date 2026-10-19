/**
 * What is wired up for one agent in this project: MCP connection, hook roles (installed / stale / missing),
 * and the edit-gate configuration. Read-only; shared by `flowlens agent status` and the doctor check.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentIntegrationStatus, AgentProviderId, FlowLensHookRole } from '../../contracts/agent-setup.js';
import { loadAgentConfig } from '../agent-config.js';
import { buildClaudeCodeHookSettings, describeHookRoles, listFlowLensHooks } from '../claude-hooks.js';
import type { ClaudeSettings } from '../../contracts/agent.js';
import { codexHookStatus, codexHooksPath } from '../codex-hooks.js';
import { defaultHookBaseCommand, portableHookBaseCommand } from '../hook-command.js';
import { claudeLocalSettingsPath, claudeSettingsPath, loadClaudeSettings } from '../settings-file.js';
import { detectMcpConnection, type DetectOptions } from './mcp-detect.js';
import { splitCommandLine } from './serve-command.js';

type Roles = AgentIntegrationStatus['hooks'];

/** Union over alternatives (several candidate commands, several files): installed anywhere wins, then stale. */
function mergeRoles(all: FlowLensHookRole[], parts: Roles[]): Roles {
  const installed = all.filter((r) => parts.some((p) => p.installed.includes(r)));
  const stale = all.filter((r) => !installed.includes(r) && parts.some((p) => p.stale.includes(r)));
  return { installed, stale, missing: all.filter((r) => !installed.includes(r) && !stale.includes(r)) };
}

/** Commands a hook may legitimately carry: this install's absolute one, or the portable one (shared). */
function candidateCommands(projectDir: string, shared: boolean): string[] {
  const portable = shared ? portableHookBaseCommand(projectDir) : null;
  return [portable, defaultHookBaseCommand()].filter((c): c is string => c !== null);
}

/** The base command an installed FlowLens hook runs (everything before ` agent <subcommand>`). */
function baseOf(command: string): string | null {
  return /^(.*?) agent (?:context|guard|gate|record)\b/.exec(command)?.[1] ?? null;
}

/** A base command still works when every absolute path in it exists (a moved or deleted install does not). */
function baseResolves(base: string): boolean {
  return splitCommandLine(base).filter((t) => t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)).every((t) => existsSync(t));
}

/**
 * Commands to compare a settings file's hooks against: the defaults, plus the base the file already uses when
 * it still resolves (so a deliberate `--command` is not reported stale, but a moved install is).
 */
function commandsFor(projectDir: string, shared: boolean, settings: ClaudeSettings): string[] {
  const own = listFlowLensHooks(settings).map((h) => baseOf(h.command)).filter((b): b is string => b !== null && baseResolves(b));
  return [...new Set([...candidateCommands(projectDir, shared), ...own])];
}

async function claudeHookRoles(projectDir: string, gate: boolean): Promise<Roles> {
  const all = describeHookRoles({}, buildClaudeCodeHookSettings(defaultHookBaseCommand(), { gate }));
  const roles = [...all.installed, ...all.stale, ...all.missing];
  const parts: Roles[] = [];
  for (const [path, shared] of [[claudeLocalSettingsPath(projectDir), false], [claudeSettingsPath(projectDir), true]] as const) {
    try {
      const loaded = await loadClaudeSettings(path);
      if (!loaded.exists || listFlowLensHooks(loaded.settings).length === 0) continue;
      for (const command of commandsFor(projectDir, shared, loaded.settings)) {
        parts.push(describeHookRoles(loaded.settings, buildClaudeCodeHookSettings(command, { gate })));
      }
    } catch { /* an unreadable settings file is reported by `agent install`, not here */ }
  }
  return mergeRoles(roles, parts);
}

async function codexHookRoles(projectDir: string, gate: boolean): Promise<Roles> {
  const parts: Roles[] = [];
  let all: FlowLensHookRole[] = [];
  try {
    const first = await codexHookStatus(projectDir, defaultHookBaseCommand(), gate);
    all = [...first.installed, ...first.stale, ...first.missing];
    const loaded = await loadClaudeSettings(codexHooksPath(projectDir));
    for (const shared of [false, true]) {
      for (const command of commandsFor(projectDir, shared, loaded.settings)) parts.push(await codexHookStatus(projectDir, command, gate));
    }
  } catch { /* unreadable: counts as missing */ }
  return mergeRoles(all, parts);
}

export async function agentIntegrationStatus(
  projectDir: string, provider: AgentProviderId, options: DetectOptions = {},
): Promise<AgentIntegrationStatus> {
  const mcp = await detectMcpConnection(projectDir, provider, options);
  const config = await loadAgentConfig(join(projectDir, '.flowlens'));
  const gateExpected = config.config.enabled && mcp.state === 'connected';
  const hooks = provider === 'claude-code' ? await claudeHookRoles(projectDir, gateExpected) : await codexHookRoles(projectDir, gateExpected);
  return {
    provider,
    mcp: mcp.state,
    ...(mcp.via ? { mcp_via: mcp.via } : {}),
    hooks,
    gate: { enabled: config.config.enabled, config_path: config.path, ...(config.error ? { error: config.error } : {}) },
  };
}
