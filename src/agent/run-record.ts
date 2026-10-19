/**
 * `flowlens agent record --hook` (PostToolUse on `mcp__flowlens__.*`): note in the session's event log
 * that a FlowLens tool was called and which files it covered. Silent, fast, never fails the hook.
 */
import { existsSync } from 'node:fs';
import type { AgentCommandResult, ClaudeHookInput } from '../contracts/agent.js';
import { appendLogEvent } from './ledger.js';
import { flowlensDirFor } from './graph-access.js';
import { creditedFiles, flowlensToolName, responseText } from './record.js';

const NOTHING: AgentCommandResult = { exit_code: 0, stdout: '', stderr: '' };

export async function runAgentRecord(rootDir: string, hookInput: ClaudeHookInput): Promise<AgentCommandResult> {
  try {
    const tool = flowlensToolName(hookInput.tool_name);
    const sessionId = hookInput.session_id;
    const flowlensDir = flowlensDirFor(rootDir);
    if (!tool || !sessionId || !existsSync(flowlensDir)) return NOTHING;
    await appendLogEvent(flowlensDir, {
      t: 'query',
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool,
      files: creditedFiles(tool, hookInput.tool_response),
      response_chars: responseText(hookInput.tool_response).length,
    });
  } catch {
    // logging must never break the agent
  }
  return NOTHING;
}
