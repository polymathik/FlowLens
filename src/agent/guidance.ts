/**
 * The "Guidance" lines that tell an agent to use the FlowLens tools, with their exact names (an agent whose
 * tools are deferred can then load them in one step). Phrased as the project's convention, not as commands:
 * Claude Code's hook docs warn that imperative, system-style context can be treated as prompt injection.
 * Pure; the caller decides `tools` (MCP not known to be missing) and `gate` (the PreToolUse gate is installed).
 */
import { FLOWLENS_TOOL_PREFIX } from '../contracts/agent-setup.js';

export interface ToolGuidanceOptions {
  tools: boolean;
  gate: boolean;
  agent?: 'claude-code' | 'codex';
}

const dependents = `${FLOWLENS_TOOL_PREFIX}get_dependents`;
const context = `${FLOWLENS_TOOL_PREFIX}get_context`;
const flow = `${FLOWLENS_TOOL_PREFIX}trace_flow`;

export function buildToolGuidance({ tools, gate, agent = 'claude-code' }: ToolGuidanceOptions): string[] {
  if (!tools) return [];
  const lines = [
    `Project convention: before editing a file, call \`${dependents}\` on the symbols being changed; it lists their callers with file:line.`,
    `For a question about a feature, \`${context}\` with the feature name is more precise than the "Relevant files" list above, which is keyword matching and can be noisy. \`${flow}\` answers "what happens when X runs".`,
  ];
  if (gate) {
    lines.push('Edits to protected files (hotspots and configured paths) are held until `get_dependents` or `get_context` has been called for that file in this session.');
  }
  if (agent === 'claude-code') {
    lines.push(`These tools may be deferred: load them first with ToolSearch \`select:${dependents},${context},${flow}\`.`);
  }
  return lines;
}
