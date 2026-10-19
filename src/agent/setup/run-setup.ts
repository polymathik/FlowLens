/**
 * One-step agent connection: per provider, register the FlowLens MCP server and install the hooks.
 *
 * A failure in one step or provider never aborts the others; it becomes a `notes` entry. The edit gate is
 * only installed when the MCP tools it points the agent to are (or are being) connected.
 */
import type { AgentInstallResult, ClaudeCodeHookInstallOptions } from '../../contracts/agent.js';
import type {
  AgentProviderId, AgentSetupRequest, AgentSetupResult, McpInstallResult,
} from '../../contracts/agent-setup.js';
import { installClaudeCodeHooks } from '../claude-code.js';
import { installCodexHooks, type CodexHookInstallOptions } from '../codex-hooks.js';
import type { CliDeps } from './claude-cli.js';
import { detectMcpConnection } from './mcp-detect.js';
import { installClaudeMcp } from './mcp-claude.js';
import { installCodexMcp } from './mcp-codex.js';
import { errorMessage } from './types.js';

/** Seams for tests: the `claude` CLI, the home directory and the hook installers. */
export interface SetupDeps {
  cli?: CliDeps;
  homeDir?: string;
  installClaudeHooks?: (o: ClaudeCodeHookInstallOptions) => Promise<AgentInstallResult>;
  installCodexHooks?: (o: CodexHookInstallOptions) => Promise<AgentInstallResult>;
}

/** Failure notes read `<Agent>: could not …` / `<Agent> setup failed: …`; the CLI turns them into an error exit. */
export const isFailureNote = (note: string): boolean => /: could not |setup failed:/.test(note);

export const PROVIDER_LABEL: Record<AgentProviderId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

export async function runAgentSetup(req: AgentSetupRequest, deps: SetupDeps = {}): Promise<AgentSetupResult[]> {
  const results: AgentSetupResult[] = [];
  for (const provider of dedupe(req.providers)) {
    try {
      results.push(await setupProvider(provider, req, deps));
    } catch (err) {
      results.push({ provider, notes: [`${PROVIDER_LABEL[provider]} setup failed: ${errorMessage(err)}`] });
    }
  }
  return results;
}

const dedupe = <T>(list: T[]): T[] => [...new Set(list)];

async function setupProvider(provider: AgentProviderId, req: AgentSetupRequest, deps: SetupDeps): Promise<AgentSetupResult> {
  const label = PROVIDER_LABEL[provider];
  const out: AgentSetupResult = { provider, notes: [] };
  const shared = req.scope === 'shared';

  // 1. MCP
  let mcpConnected = false;
  if (req.mcp !== false) {
    try {
      out.mcp = provider === 'claude-code'
        ? await installClaudeMcp({ projectDir: req.project_dir, scope: req.scope, force: req.force, command: req.command, deps: deps.cli, homeDir: deps.homeDir })
        : await installCodexMcp({ projectDir: req.project_dir, scope: req.scope, command: req.command });
      mcpConnected = true;
      out.notes.push(...mcpNotes(provider, out.mcp));
    } catch (err) {
      out.notes.push(`${label}: could not register the MCP server (${errorMessage(err)}). Hooks are installed without the edit gate.`);
    }
  }
  if (!mcpConnected) {
    // MCP skipped or failed: it may still be connected from an earlier run.
    mcpConnected = (await detectMcpConnection(req.project_dir, provider, { homeDir: deps.homeDir })).state === 'connected';
  }

  // 2. Hooks
  if (req.hooks !== false) {
    const wantGate = req.gate ?? true;
    const gate = wantGate && mcpConnected;
    try {
      const options = { project_dir: req.project_dir, shared, force: req.force, command: req.command, gate };
      out.hooks = provider === 'claude-code'
        ? await (deps.installClaudeHooks ?? installClaudeCodeHooks)(options)
        : await (deps.installCodexHooks ?? installCodexHooks)(options);
      if (wantGate && !gate) out.notes.push(`${label}: the edit gate was not installed because the FlowLens MCP server is not connected; re-run "flowlens agent install ${provider}" once it is.`);
      if (provider === 'codex') {
        out.notes.push('Codex: review the new hooks once with /hooks in Codex; it only runs hooks you have trusted.');
      }
    } catch (err) {
      out.notes.push(`${label}: could not install hooks (${errorMessage(err)}).`);
    }
  }
  if (provider === 'codex' && (out.mcp || out.hooks)) {
    out.notes.push('Codex only loads project-level .codex/ config for trusted projects: trust this project in Codex, then start a new session.');
  }
  if (provider === 'claude-code' && (out.mcp?.changed || out.hooks?.hooks_added)) {
    out.notes.push('Claude Code: start a new session (or run /mcp and /hooks) to load the changes.');
  }
  return out;
}

/** What the user should know after an MCP registration. */
export function mcpNotes(provider: AgentProviderId, mcp: McpInstallResult): string[] {
  const notes: string[] = [];
  if (provider === 'claude-code' && mcp.method === 'mcp-json') {
    notes.push('Claude Code asks you once to approve a server from a project .mcp.json; accept the FlowLens server when it prompts (or run /mcp).');
  }
  for (const w of mcp.warnings ?? []) notes.push(w);
  return notes;
}
