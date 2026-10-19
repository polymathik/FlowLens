/**
 * Whether the FlowLens MCP server is connected for an agent in this project. Hooks use it to avoid telling
 * an agent to call tools it does not have, and the gate uses it to fail open. The detection itself lives
 * in `setup/mcp-detect.ts` (lane B); this facade is the only import the hooks make.
 */
import type { AgentProviderId } from '../contracts/agent-setup.js';

export type McpState = 'connected' | 'not_connected' | 'unknown';

export async function getMcpState(_rootDir: string, _provider: AgentProviderId = 'claude-code'): Promise<McpState> {
  return 'unknown';
}
