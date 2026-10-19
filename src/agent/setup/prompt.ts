/**
 * The agent-connection step of `flowlens init`: ask (once, in plain words) whether to connect Claude Code and
 * Codex, or follow the flags. Uses node:readline only. Nothing here may fail `init`: every error becomes a
 * warning with the manual command.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AGENT_PROVIDERS, type AgentProviderId, type AgentSetupRequest, type AgentSetupResult } from '../../contracts/agent-setup.js';
import { whichSync } from './claude-cli.js';
import { formatSetupResult } from './format.js';
import { PROVIDER_LABEL, runAgentSetup } from './run-setup.js';
import { errorMessage } from './types.js';

export interface InitAgentFlags {
  /** `--yes`: connect Claude Code (or `--agents`) without asking. */
  yes?: boolean;
  /** `--agents claude-code,codex` (implies consent). */
  agents?: string;
  /** Commander's `--no-agent` leaves `false` here. */
  agent?: boolean;
  /** `--shared`: team scope (committed config). */
  shared?: boolean;
}

/** Parse `--agents`; throws on an unknown name so `init` can stop before it indexes anything. */
export function parseAgentList(value: string): AgentProviderId[] {
  const names = value.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !(AGENT_PROVIDERS as readonly string[]).includes(n));
  if (names.length === 0 || bad.length > 0) {
    throw new Error(`Unknown agent "${bad[0] ?? value}" for --agents. Use: ${AGENT_PROVIDERS.join(', ')}.`);
  }
  return [...new Set(names as AgentProviderId[])];
}

/** Everything the prompt touches, replaceable in tests. */
export interface PromptIo {
  interactive: boolean;
  ask(question: string): Promise<string>;
  log(line: string): void;
  warn(line: string): void;
  codexDetected(): boolean;
  setup(req: AgentSetupRequest): Promise<AgentSetupResult[]>;
}

export function realPromptIo(): PromptIo & { close(): void } {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
  let rl: ReturnType<typeof createInterface> | undefined;
  return {
    interactive,
    ask: (q) => (rl ??= createInterface({ input: process.stdin, output: process.stdout })).question(q),
    log: (l) => console.log(l),
    warn: (l) => console.log(`⚠ ${l}`),
    codexDetected: () => existsSync(join(homedir(), '.codex')) || whichSync('codex') !== null,
    setup: (req) => runAgentSetup(req),
    close: () => rl?.close(),
  };
}

export const NEXT_HINT = 'Next: flowlens agent install claude-code (connects Claude Code: MCP tools + hooks)';

function explain(shared: boolean): string {
  return shared
    ? 'FlowLens can connect to Claude Code so the agent can query the code graph. This adds a FlowLens entry to .mcp.json and hooks to .claude/settings.json, both meant to be committed for the team. The hooks give the agent graph context, check its edits, and hold edits to risky files until it has looked them up. Undo with: flowlens agent uninstall claude-code'
    : 'FlowLens can connect to Claude Code so the agent can query the code graph. This registers the FlowLens MCP server for you only (not committed) and adds hooks to .claude/settings.local.json that give the agent graph context, check its edits, and hold edits to risky files until it has looked them up. Undo with: flowlens agent uninstall claude-code';
}

const isYes = (answer: string, defaultYes: boolean): boolean => {
  const a = answer.trim().toLowerCase();
  return a === '' ? defaultYes : a === 'y' || a === 'yes';
};

/** Decide which agents to connect (asking when interactive), or null when nothing should be done. */
async function choose(flags: InitAgentFlags, io: PromptIo): Promise<AgentProviderId[] | null> {
  if (flags.agents) return parseAgentList(flags.agents);
  if (flags.yes) return ['claude-code'];
  if (!io.interactive) return null;
  io.log(`\n${explain(Boolean(flags.shared))}`);
  const chosen: AgentProviderId[] = [];
  if (isYes(await io.ask('Connect Claude Code? [Y/n] '), true)) chosen.push('claude-code');
  if (io.codexDetected() && isYes(await io.ask('Connect Codex? [Y/n] '), true)) chosen.push('codex');
  return chosen;
}

/** Run after a successful init. Never throws. */
export async function connectAgentsAfterInit(rootDir: string, flags: InitAgentFlags, io: PromptIo = realPromptIo()): Promise<void> {
  if (flags.agent === false) return;
  let providers: AgentProviderId[] | null;
  try {
    providers = await choose(flags, io);
  } catch (err) {
    io.warn(`Could not read your answer (${errorMessage(err)}). Connect an agent later with: flowlens agent install claude-code`);
    return;
  } finally {
    (io as { close?: () => void }).close?.();
  }
  if (providers === null) {
    io.log(`\n${NEXT_HINT}`);
    return;
  }
  for (const provider of providers) {
    try {
      const [result] = await io.setup({ project_dir: rootDir, providers: [provider], scope: flags.shared ? 'shared' : 'local' });
      for (const line of formatSetupResult(result)) io.log(line);
      if (!result.mcp && !result.hooks) io.warn(`${PROVIDER_LABEL[provider]} was not connected. Try again with: flowlens agent install ${provider}`);
    } catch (err) {
      io.warn(`${PROVIDER_LABEL[provider]} was not connected (${errorMessage(err)}). Try again with: flowlens agent install ${provider}`);
    }
  }
}
