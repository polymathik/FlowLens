/** Setup-internal types shared by the MCP writers, detection and the runner (contracts live in contracts/agent-setup.ts). */
import type { AgentProviderId, AgentSetupScope } from '../../contracts/agent-setup.js';

/** The command an agent runs to start the FlowLens MCP server. */
export interface ServeCommand {
  command: string;
  args: string[];
  /** Human-readable single line, e.g. `node "/abs/dist/cli/index.js" serve`. */
  display: string;
  /** True when the command embeds an absolute path on this machine. */
  machine_specific: boolean;
  warnings: string[];
}

export interface McpUninstallResult {
  provider: AgentProviderId;
  /** What was removed, e.g. `.mcp.json` or `claude mcp remove (local scope)`. */
  removed: string[];
  backup_paths: string[];
  warnings: string[];
}

export interface McpUninstallOptions {
  /** Restrict to one scope (default: both). */
  scope?: AgentSetupScope;
  deps?: import('./claude-cli.js').CliDeps;
  homeDir?: string;
}

export class McpConfigError extends Error {
  constructor(readonly code: 'invalid_json' | 'invalid_shape' | 'io' | 'unbalanced_block', readonly path: string, message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
