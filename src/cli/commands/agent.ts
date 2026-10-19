import { Command } from 'commander';
import { runAgentContext } from '../../agent/run-context.js';
import { runAgentGuard } from '../../agent/run-guard.js';
import { changedFilesFromHook, promptFromHook, readHookInput, resolveAgentRoot } from '../../agent/hook-input.js';
import { resolveChangedFiles } from '../../agent/changed-files.js';
import { runAgentBaseline } from '../../agent/run-baseline.js';
import {
  parseBudget,
  parseEvent,
  parseFileList,
  parseFormat,
  parseMaxItems,
  parseRisk,
} from '../../agent/options.js';
import { DEFAULT_BUDGET_CHARS } from '../../agent/hook-output.js';
import { AGENT_OPTION_HELP, addHookCommands, parseAgentId } from './agent-hooks.js';
import { execute } from './agent-exec.js';
import { addAgentSetupCommands } from './agent-setup.js';

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
  .option('--gate', 'Hook mode: the PreToolUse edit gate is installed (the context says protected edits are held)')
  .option('--agent <agent>', AGENT_OPTION_HELP)
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
      sessionId: hookInput.session_id,
      transcriptPath: hookInput.transcript_path,
      source: hookInput.source,
      agent: parseAgentId(opts.agent),
      gate: Boolean(opts.gate),
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
  .option('--agent <agent>', AGENT_OPTION_HELP)
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

addHookCommands(agentCommand);

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

addAgentSetupCommands(agentCommand);
