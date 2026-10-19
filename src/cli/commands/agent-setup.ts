/**
 * `flowlens agent install|uninstall claude-code|codex` and `flowlens agent status`: one step connects an
 * agent (MCP server + hooks). Registered on the `agent` command with `addAgentSetupCommands`.
 */
import { Command } from 'commander';
import type { AgentUninstallResult } from '../../contracts/agent.js';
import { AGENT_PROVIDERS, type AgentProviderId } from '../../contracts/agent-setup.js';
import { uninstallClaudeCodeHooks } from '../../agent/claude-code.js';
import { uninstallCodexHooks } from '../../agent/codex-hooks.js';
import { resolveAgentRoot } from '../../agent/hook-input.js';
import { parseFormat } from '../../agent/options.js';
import { formatSetupResult, formatStatus } from '../../agent/setup/format.js';
import { uninstallClaudeMcp } from '../../agent/setup/mcp-claude.js';
import { uninstallCodexMcp } from '../../agent/setup/mcp-codex.js';
import { PROVIDER_LABEL, isFailureNote, runAgentSetup } from '../../agent/setup/run-setup.js';
import { agentIntegrationStatus } from '../../agent/setup/status.js';
import type { McpUninstallResult } from '../../agent/setup/types.js';
import { errorMessage } from '../../agent/setup/types.js';
import { done, execute } from './agent-exec.js';

const ROOT_HELP = 'Project root (default: current directory)';

function installCommandFor(provider: AgentProviderId): Command {
  const label = PROVIDER_LABEL[provider];
  const where = provider === 'claude-code'
    ? 'MCP server via "claude mcp add" (personal) or .mcp.json (--shared), hooks in .claude/settings.local.json (--shared: .claude/settings.json)'
    : 'MCP server and hooks in .codex/ (--shared: committed; otherwise kept out of git)';
  return new Command(provider)
    .description(`Connect ${label} to FlowLens: ${where}`)
    .option('--command <command>', 'Base command used to run FlowLens (default: node "<this install>/dist/cli/index.js"; with --shared, "npx --no-install flowlens" when FlowLens is a project dependency)')
    .option('--shared', 'Write the committed, team-wide config instead of your personal one')
    .option('--force', 'Rewrite FlowLens entries even when they are up to date')
    .option('--no-mcp', 'Do not register the MCP server')
    .option('--no-hooks', 'Do not install hooks')
    .option('--no-gate', 'Do not install the edit gate (the hook that holds risky edits until FlowLens was queried)')
    .option('--format <format>', 'Output format: markdown, json', 'markdown')
    .option('--root <dir>', ROOT_HELP)
    .action((opts) => execute(async () => {
      const format = parseFormat(opts.format);
      const mcp = opts.mcp !== false;
      const hooks = opts.hooks !== false;
      const [result] = await runAgentSetup({
        project_dir: resolveAgentRoot(opts.root, {}),
        providers: [provider],
        scope: opts.shared ? 'shared' : 'local',
        mcp, hooks, gate: opts.gate !== false,
        force: Boolean(opts.force),
        command: opts.command,
      });
      const failed = result.notes.filter(isFailureNote);
      const incomplete = (mcp && !result.mcp) || (hooks && !result.hooks);
      const text = format === 'json'
        ? JSON.stringify({ ...result.hooks, provider, mcp: result.mcp, notes: result.notes }, null, 2)
        : formatSetupResult(result).join('\n');
      return { exit_code: incomplete && failed.length > 0 ? 2 : 0, stdout: text, stderr: incomplete ? failed.map((n) => `flowlens agent: ${n}`).join('\n') : '' };
    }));
}

function uninstallCommandFor(provider: AgentProviderId): Command {
  return new Command(provider)
    .description(`Remove the FlowLens MCP server entry and hooks that FlowLens added for ${PROVIDER_LABEL[provider]} (other servers and hooks stay)`)
    .option('--shared', 'Only the shared (committed) config')
    .option('--local', 'Only your personal config')
    .option('--format <format>', 'Output format: markdown, json', 'markdown')
    .option('--root <dir>', ROOT_HELP)
    .action((opts) => execute(async () => {
      const format = parseFormat(opts.format);
      const root = resolveAgentRoot(opts.root, {});
      const scope = opts.shared ? 'shared' : opts.local ? 'local' : undefined;
      const hooks: AgentUninstallResult = provider === 'claude-code'
        ? await uninstallClaudeCodeHooks(root, scope)
        : await uninstallCodexHooks(root);
      const mcp: McpUninstallResult = await (provider === 'claude-code' ? uninstallClaudeMcp(root, { scope }) : uninstallCodexMcp(root))
        .catch((err: unknown) => ({ provider, removed: [], backup_paths: [], warnings: [errorMessage(err)] }));
      if (format === 'json') return done(JSON.stringify({ ...hooks, mcp }, null, 2));
      const nothing = hooks.hooks_removed === 0 && mcp.removed.length === 0;
      const lines = nothing
        ? [`No FlowLens entries for ${PROVIDER_LABEL[provider]} found in ${root}; nothing to remove.`]
        : [
          `FlowLens removed from ${PROVIDER_LABEL[provider]}.`,
          ...(hooks.files ?? []).filter((f) => f.hooks_removed > 0).map((f) => `  ${f.path}: ${f.hooks_removed} hook(s) removed${f.backup_path ? ` (backup: ${f.backup_path})` : ''}`),
          ...mcp.removed.map((r) => `  MCP server: removed ${r}`),
          ...mcp.backup_paths.map((b) => `  backup: ${b}`),
        ];
      lines.push(...mcp.warnings.map((w) => `Warning: ${w}`));
      return done(lines.join('\n'));
    }));
}

export function addAgentSetupCommands(agent: Command): void {
  const install = new Command('install').description('Connect a coding agent (MCP server + hooks)');
  const uninstall = new Command('uninstall').description('Remove what "install" added for a coding agent');
  for (const provider of AGENT_PROVIDERS) {
    install.addCommand(installCommandFor(provider));
    uninstall.addCommand(uninstallCommandFor(provider));
  }
  agent.addCommand(install);
  agent.addCommand(uninstall);
  agent.addCommand(new Command('status')
    .description('Show which coding agents are connected to FlowLens in this project (MCP server, hooks, edit gate)')
    .option('--format <format>', 'Output format: markdown, json', 'markdown')
    .option('--root <dir>', ROOT_HELP)
    .action((opts) => execute(async () => {
      const format = parseFormat(opts.format);
      const root = resolveAgentRoot(opts.root, {});
      const statuses = await Promise.all(AGENT_PROVIDERS.map((p) => agentIntegrationStatus(root, p)));
      return done(format === 'json' ? JSON.stringify(statuses, null, 2) : statuses.flatMap((s) => [...formatStatus(s), '']).join('\n').trimEnd());
    })));
}
