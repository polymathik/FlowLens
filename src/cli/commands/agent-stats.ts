import { Command } from 'commander';
import type { AgentCommandResult } from '../../contracts/agent.js';
import { resolveAgentRoot } from '../../agent/hook-input.js';
import { AgentUsageError } from '../../agent/options.js';
import { parseLimit, parseSince } from '../../agent/stats/since.js';
import { runAgentStats } from '../../agent/stats/run-stats.js';

export const agentStatsCommand = new Command('stats')
  .description('Show whether coding agents used FlowLens and how much they searched. Reads the FlowLens event log and the agent\'s own transcripts (Claude Code; Codex transcripts are not supported yet).')
  .option('--session <id>', 'Details for one session (the id, or the start of it)')
  .option('--since <when>', 'Only sessions since 7d, 12h, 2w or a date like 2026-10-01')
  .option('--limit <n>', 'Number of sessions to show (default 10; 100 with --history)')
  .option('--history', 'Scan Claude Code history for this project (no FlowLens event log needed) and compare sessions with and without FlowLens')
  .option('--format <format>', 'Output format: text, json', 'text')
  .option('--root <dir>', 'Project root (default: current directory)')
  .action(async (opts) => {
    let result: AgentCommandResult;
    try {
      if (opts.format !== 'text' && opts.format !== 'json') {
        throw new AgentUsageError(`Invalid --format "${String(opts.format)}". Expected one of: text, json.`);
      }
      result = await runAgentStats({
        root: resolveAgentRoot(opts.root, {}),
        session: typeof opts.session === 'string' && opts.session.trim() ? opts.session.trim() : undefined,
        sinceMs: opts.since === undefined ? null : parseSince(String(opts.since)),
        limit: opts.limit === undefined ? undefined : parseLimit(opts.limit),
        history: Boolean(opts.history),
        format: opts.format,
      });
    } catch (err) {
      if (!(err instanceof AgentUsageError)) throw err;
      result = { exit_code: 2, stdout: '', stderr: `flowlens agent: ${err.message}` };
    }
    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exitCode = result.exit_code;
  });
