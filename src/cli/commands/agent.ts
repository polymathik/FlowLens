import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { buildAgentContext } from '../../agent/context-builder.js';
import { buildAgentGuardReport } from '../../agent/guard.js';
import { formatContextMarkdown, formatGuardMarkdown } from '../../agent/format.js';
import {
  installClaudeCodeHooks,
  uninstallClaudeCodeHooks,
} from '../../agent/claude-code.js';
import {
  changedFilesFromHook,
  promptFromHook,
  readHookInput,
} from '../../agent/hook-input.js';
import { getGitChangedFiles } from '../../agent/changed-files.js';
import { reindexAgentChangedFiles } from '../../agent/reindex.js';
import type { AgentEvent, AgentOutputFormat } from '../../contracts/agent.js';

const SETUP_HINT = 'FlowLens context unavailable. Run `flowlens init` and `flowlens index` first.';

export const agentCommand = new Command('agent')
  .description('Agent integration commands for context injection and edit guards');

agentCommand.addCommand(new Command('context')
  .description('Build compact context for coding agents')
  .option('--event <event>', 'Agent event name', 'prompt_submit')
  .option('--prompt <prompt>', 'Task prompt to match against the graph')
  .option('--changed <files>', 'Comma-separated changed files')
  .option('--max-items <count>', 'Maximum items per section', '8')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--hook', 'Read Claude Code hook JSON from stdin')
  .option('--git', 'Use git changed files when --changed is not provided')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const hookInput = opts.hook ? await readHookInput(process.stdin) : {};
    const prompt = opts.prompt ?? promptFromHook(hookInput);
    const { files: changed } = resolveChangedFiles({
      explicit: parseFiles(opts.changed),
      hook: changedFilesFromHook(hookInput, rootDir),
      rootDir,
      useGit: Boolean(opts.git),
    });

    await withGraph(rootDir, async (graph, flowlensDir) => {
      const packet = await buildAgentContext(graph, {
        event: opts.event as AgentEvent,
        prompt,
        changed_files: changed,
        max_items: parseInt(opts.maxItems, 10),
      }, { flowlensDir });
      printContext(packet, opts.format);
    });
  }));

agentCommand.addCommand(new Command('guard')
  .description('Report graph risk for changed files')
  .option('--changed <files>', 'Comma-separated changed files')
  .option('--max-items <count>', 'Maximum items per section', '10')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .option('--hook', 'Read Claude Code PostToolUse hook JSON from stdin')
  .option('--git', 'Use git changed files when hook/argument input is empty')
  .option('--reindex', 'Incrementally re-index changed files before guard analysis')
  .option('--strict', 'Exit with code 2 on high risk')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const hookInput = opts.hook ? await readHookInput(process.stdin) : {};
    const changed = resolveChangedFiles({
      explicit: parseFiles(opts.changed),
      hook: changedFilesFromHook(hookInput, rootDir),
      rootDir,
      useGit: Boolean(opts.git) || Boolean(opts.hook),
    });

    await withGraph(rootDir, async (graph, flowlensDir) => {
      const reindex = opts.reindex || opts.hook
        ? await reindexAgentChangedFiles(rootDir, graph, changed.files)
        : undefined;
      const report = await buildAgentGuardReport(graph, {
        changed_files: changed.files,
        changed_source: changed.source,
        max_items: parseInt(opts.maxItems, 10),
        reindex,
      }, { flowlensDir });
      const markdown = formatGuardMarkdown(report);
      if (opts.strict && report.risk === 'high') {
        console.error(markdown);
        process.exit(2);
      }
      printGuard(report, opts.format);
    });
  }));

const installCommand = new Command('install')
  .description('Install agent integrations');

installCommand.addCommand(new Command('claude-code')
  .description('Install Claude Code project hooks')
  .option('--command <command>', 'FlowLens command to run from hooks', 'flowlens')
  .option('--force', 'Replace existing FlowLens hook command entries')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .action(async (opts) => {
    const result = await installClaudeCodeHooks({
      project_dir: resolve('.'),
      command: opts.command,
      force: Boolean(opts.force),
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('FlowLens Claude Code hooks installed.');
      console.log(`Settings: ${result.settings_path}`);
      console.log(`Hooks added: ${result.hooks_added}; already present: ${result.hooks_existing}`);
    }
  }));

agentCommand.addCommand(installCommand);

const uninstallCommand = new Command('uninstall')
  .description('Uninstall agent integrations');

uninstallCommand.addCommand(new Command('claude-code')
  .description('Remove FlowLens Claude Code project hooks')
  .option('--format <format>', 'Output format: markdown, json', 'markdown')
  .action(async (opts) => {
    const result = await uninstallClaudeCodeHooks(resolve('.'));
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('FlowLens Claude Code hooks removed.');
      console.log(`Settings: ${result.settings_path}`);
      console.log(`Hooks removed: ${result.hooks_removed}`);
    }
  }));

agentCommand.addCommand(uninstallCommand);

async function withGraph(
  rootDir: string,
  callback: (graph: LevelGraphStore, flowlensDir: string) => Promise<void>,
): Promise<void> {
  const flowlensDir = join(rootDir, '.flowlens');
  if (!existsSync(flowlensDir)) {
    console.log(SETUP_HINT);
    return;
  }
  const graph = new LevelGraphStore();
  try {
    await openGraphWithRetry(graph, join(flowlensDir, 'graph'));
  } catch {
    console.log('FlowLens graph is busy. Try again after the current indexing or guard run finishes.');
    return;
  }
  try {
    await callback(graph, flowlensDir);
  } finally {
    await graph.close();
  }
}

async function openGraphWithRetry(graph: LevelGraphStore, dbPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await graph.open(dbPath);
      return;
    } catch (err) {
      lastError = err;
      await delay(150);
    }
  }
  throw lastError;
}

function printContext(
  packet: Awaited<ReturnType<typeof buildAgentContext>>,
  format: AgentOutputFormat,
): void {
  if (format === 'json') console.log(JSON.stringify(packet, null, 2));
  else console.log(formatContextMarkdown(packet));
}

function printGuard(
  report: Awaited<ReturnType<typeof buildAgentGuardReport>>,
  format: AgentOutputFormat,
): void {
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else console.log(formatGuardMarkdown(report));
}

function parseFiles(files: string | undefined): string[] {
  if (!files) return [];
  return files.split(',').map((file) => file.trim()).filter(Boolean);
}

function resolveChangedFiles(options: {
  explicit: string[];
  hook: string[];
  rootDir: string;
  useGit: boolean;
}): { files: string[]; source: 'argument' | 'hook' | 'git' | 'none' } {
  if (options.explicit.length > 0) {
    return { files: dedupe(options.explicit), source: 'argument' };
  }
  if (options.hook.length > 0) {
    return { files: dedupe(options.hook), source: 'hook' };
  }
  if (options.useGit) {
    const gitFiles = getGitChangedFiles(options.rootDir);
    if (gitFiles.length > 0) return { files: gitFiles, source: 'git' };
  }
  return { files: [], source: 'none' };
}

function dedupe(files: string[]): string[] {
  return [...new Set(files)].sort();
}
