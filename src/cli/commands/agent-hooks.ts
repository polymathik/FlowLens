/**
 * The hook-only `agent` subcommands (Phase 23): `gate` (PreToolUse edit gate) and `record` (PostToolUse on
 * FlowLens MCP tools), plus the `--agent` option every hook command accepts.
 */
import { Command } from 'commander';
import { AGENT_PROVIDERS, type AgentProviderId } from '../../contracts/agent-setup.js';
import { readHookInput, resolveAgentRoot } from '../../agent/hook-input.js';
import { AgentUsageError } from '../../agent/options.js';
import { runAgentGate } from '../../agent/run-gate.js';
import { runAgentRecord } from '../../agent/run-record.js';
import { execute } from './agent-exec.js';

export const AGENT_OPTION_HELP = `Agent the hook runs for: ${AGENT_PROVIDERS.join(', ')} (default claude-code)`;
const ROOT_HELP = 'Project root (hooks pass "$CLAUDE_PROJECT_DIR"); defaults to hook cwd, then the current directory';

export function parseAgentId(value: string | undefined): AgentProviderId {
  const id = (value ?? 'claude-code') as AgentProviderId;
  if (!AGENT_PROVIDERS.includes(id)) throw new AgentUsageError(`--agent must be one of: ${AGENT_PROVIDERS.join(', ')}`);
  return id;
}

export function addHookCommands(agent: Command): void {
  agent.addCommand(new Command('gate')
    .description('PreToolUse hook: hold edits to protected files until FlowLens was queried for them in this session')
    .option('--hook', 'Read the hook JSON from stdin and print hook JSON (the only supported mode)')
    .option('--agent <agent>', AGENT_OPTION_HELP)
    .option('--root <dir>', ROOT_HELP)
    .action((opts) => execute(async () => {
      const hookInput = await readHookInput(process.stdin);
      return runAgentGate({ rootDir: resolveAgentRoot(opts.root, hookInput), hookInput, agent: parseAgentId(opts.agent) });
    })));

  agent.addCommand(new Command('record')
    .description('PostToolUse hook: note which files a FlowLens tool call covered (feeds the gate and `agent stats`)')
    .option('--hook', 'Read the hook JSON from stdin (the only supported mode)')
    .option('--agent <agent>', AGENT_OPTION_HELP)
    .option('--root <dir>', ROOT_HELP)
    .action((opts) => execute(async () => {
      const hookInput = await readHookInput(process.stdin);
      parseAgentId(opts.agent);
      return runAgentRecord(resolveAgentRoot(opts.root, hookInput), hookInput);
    })));
}
