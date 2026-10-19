import { Command } from 'commander';
import type { AgentCommandResult } from '../../contracts/agent.js';
import { runAgentContext } from '../../agent/run-context.js';
import { runAgentGuard } from '../../agent/run-guard.js';
import { installClaudeCodeHooks, uninstallClaudeCodeHooks } from '../../agent/claude-code.js';
import { ClaudeSettingsError } from '../../agent/settings-file.js';
import { changedFilesFromHook, promptFromHook, readHookInput, resolveAgentRoot } from '../../agent/hook-input.js';
import { resolveChangedFiles } from '../../agent/changed-files.js';
import { runAgentBaseline } from '../../agent/run-baseline.js';
import {
  AgentUsageError,
  parseBudget,
  parseEvent,
  parseFileList,
  parseFormat,
  parseMaxItems,
  parseRisk,
} from '../../agent/options.js';
import { DEFAULT_BUDGET_CHARS } from '../../agent/hook-output.js';
import { agentStatsCommand } from './agent-stats.js';

const NO_DAEMON_HELP = 'Open the graph directly instead of via the FlowLens daemon (may then report "busy")';
const ROOT_HELP = 'Project root (hooks pass "$CLAUDE_PROJECT_DIR"); defaults to hook cwd, then the current directory';

export const agentCommand = new Command('agent')
  .description('Agent integration commands for context injection and edit guards');

agentCommand.addCommand(new Command('context')
  .description('Build compact context for coding agents')
  .option('--event <event>', 'Agent event name', 'prompt_submit')
  .option('--prompt <prompt>', 'Task prompt to match against the graph')
  .option('--changed <files>', 'Comma-separated changed files')
  .option('--max-items <count>', 'Maximum items per section (1-100)', '8')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--budget <chars>', 'Hook output character budget (200-9500)', String(DEFAULT_BUDGET_CHARS))
  .option('--root <dir>', ROOT_HELP)
  .option('--hook', 'Read Claude Code hook JSON from stdin and print hook JSON')
  .option('--git', 'Use git changed files when --changed is not provided')
  .option('--no-daemon', NO_DAEMON_HELP)
  .action((opts) => execute(async () => {
    const event = parseEvent(opts.event);
    const format = parseFormat(opts.format);
    const maxItems = parseMaxItems(opts.maxItems);
    const budget = parseBudget(opts.budget);
    const hookInput = opts.hook ? await readHookInput(process.stdin) : {};
    const rootDir = resolveAgentRoot(opts.root, hookInput);
    const changed = await resolveChangedFiles({
      explicit: parseFileList(opts.changed),
      hook: changedFilesFromHook(hookInput, rootDir),
      rootDir,
      useGit: Boolean(opts.git),
    });
    return runAgentContext({
      rootDir,
      event,
      prompt: opts.prompt ?? promptFromHook(hookInput),
      changedFiles: changed.files,
      maxItems,
      format,
      hook: Boolean(opts.hook),
      hookEventName: hookInput.hook_event_name,
      budget,
      daemon: opts.daemon,
    });
  })));

agentCommand.addCommand(new Command('guard')
  .description('Report graph risk for changed files')
  .option('--changed <files>', 'Comma-separated changed files')
  .option('--max-items <count>', 'Maximum items per section (1-100)', '10')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--budget <chars>', 'Hook output character budget (200-9500)', String(DEFAULT_BUDGET_CHARS))
  .option('--min-risk <risk>', 'Hook mode: lowest risk that is reported to the agent (none, low, medium, high)', 'medium')
  .option('--root <dir>', ROOT_HELP)
  .option('--hook', 'Read Claude Code PostToolUse hook JSON from stdin and print hook JSON')
  .option('--git', 'Use git changed files when hook/argument input is empty')
  .option('--reindex', 'Incrementally re-index changed files before guard analysis')
  .option('--strict', 'Block on NEW cycles/violations (exit 2, or decision:block in hook mode)')
  .option('--no-daemon', NO_DAEMON_HELP)
  .action((opts) => execute(async () => {
    const format = parseFormat(opts.format);
    const maxItems = parseMaxItems(opts.maxItems);
    const budget = parseBudget(opts.budget);
    const minRisk = parseRisk(opts.minRisk);
    const hookInput = opts.hook ? await readHookInput(process.stdin) : {};
    return runAgentGuard({
      rootDir: resolveAgentRoot(opts.root, hookInput),
      explicitFiles: parseFileList(opts.changed),
      hookInput,
      hook: Boolean(opts.hook),
      useGit: Boolean(opts.git) || Boolean(opts.hook),
      reindex: Boolean(opts.reindex) || Boolean(opts.hook),
      strict: Boolean(opts.strict),
      maxItems,
      format,
      minRisk,
      budget,
      daemon: opts.daemon,
    });
  })));

agentCommand.addCommand(new Command('baseline')
  .description('Show or reset the strict-mode baseline of pre-existing cycles/violations')
  .option('--reset', 'Re-capture the baseline for the current git HEAD from the current graph')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--root <dir>', ROOT_HELP)
  .option('--no-daemon', NO_DAEMON_HELP)
  .action((opts) => execute(async () => runAgentBaseline({
    rootDir: resolveAgentRoot(opts.root, {}),
    reset: Boolean(opts.reset),
    format: parseFormat(opts.format),
    daemon: opts.daemon,
  }))));

agentCommand.addCommand(agentStatsCommand);

const installCommand = new Command('install').description('Install agent integrations');
installCommand.addCommand(new Command('claude-code')
  .description('Install Claude Code project hooks into .claude/settings.local.json (personal; --shared: .claude/settings.json)')
  .option('--command <command>', 'Base command hooks use to run FlowLens (default: node "<this install>/dist/cli/index.js"; with --shared, "npx --no-install flowlens" when FlowLens is a project dependency)')
  .option('--shared', 'Write the committed .claude/settings.json for the whole team instead of your personal settings.local.json')
  .option('--force', 'Rewrite FlowLens hook entries even when they are up to date')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--root <dir>', 'Project root (default: current directory)')
  .action((opts) => execute(async () => {
    const format = parseFormat(opts.format);
    const result = await installClaudeCodeHooks({
      project_dir: resolveAgentRoot(opts.root, {}),
      command: opts.command,
      force: Boolean(opts.force),
      shared: Boolean(opts.shared),
    });
    const lines = [
      'FlowLens Claude Code hooks installed.',
      `Settings: ${result.settings_path} (${result.scope === 'shared' ? 'shared with the team' : 'personal, not committed'})`,
      `Hook command: ${result.command}`,
      `Hooks added: ${result.hooks_added}; refreshed: ${result.hooks_replaced ?? 0}; already up to date: ${result.hooks_existing}`,
      result.hooks_moved ? `Moved ${result.hooks_moved} FlowLens hook(s) out of ${result.moved_from}` : '',
      result.git_ignored_via ? `Kept out of git via: ${result.git_ignored_via}` : '',
      result.backup_path ? `Backup: ${result.backup_path}` : '',
      ...(result.warnings ?? []).map((w) => `Warning: ${w}`),
    ].filter(Boolean);
    return done(format === 'json' ? JSON.stringify(result, null, 2) : lines.join('\n'));
  })));
agentCommand.addCommand(installCommand);

const uninstallCommand = new Command('uninstall').description('Uninstall agent integrations');
uninstallCommand.addCommand(new Command('claude-code')
  .description('Remove FlowLens-managed Claude Code project hooks (from settings.local.json and settings.json)')
  .option('--shared', 'Only .claude/settings.json')
  .option('--local', 'Only .claude/settings.local.json')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--root <dir>', 'Project root (default: current directory)')
  .action((opts) => execute(async () => {
    const format = parseFormat(opts.format);
    const scope = opts.shared ? 'shared' : opts.local ? 'local' : undefined;
    const result = await uninstallClaudeCodeHooks(resolveAgentRoot(opts.root, {}), scope);
    const lines = result.settings_found === false
      ? [`No Claude Code settings in ${resolveAgentRoot(opts.root, {})}/.claude; nothing to remove.`]
      : [
        'FlowLens Claude Code hooks removed.',
        ...(result.files ?? []).map((f) => `${f.path}: ${f.hooks_removed} removed${f.backup_path ? ` (backup: ${f.backup_path})` : ''}`),
        `Hooks removed: ${result.hooks_removed}`,
      ];
    return done(format === 'json' ? JSON.stringify(result, null, 2) : lines.join('\n'));
  })));
agentCommand.addCommand(uninstallCommand);

function done(stdout: string): AgentCommandResult {
  return { exit_code: 0, stdout, stderr: '' };
}

/** Run a command body; usage/settings errors exit 2 with a message, nothing written. */
async function execute(body: () => Promise<AgentCommandResult>): Promise<void> {
  let result: AgentCommandResult;
  try {
    result = await body();
  } catch (err) {
    if (err instanceof AgentUsageError || err instanceof ClaudeSettingsError) {
      result = { exit_code: 2, stdout: '', stderr: `flowlens agent: ${err.message}` };
    } else {
      throw err;
    }
  }
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exit_code;
}
