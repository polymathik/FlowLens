/**
 * Claude Code hook stdout builders (https://code.claude.com/docs/en/hooks#json-output).
 *
 * - SessionStart / UserPromptSubmit: `hookSpecificOutput.additionalContext`
 *   (plain stdout also works for these two, JSON is used for consistency).
 * - PostToolUse: plain stdout only reaches the debug log, so findings MUST be
 *   returned as `hookSpecificOutput.additionalContext`. Strict blocking uses
 *   the documented top-level `decision: "block"` + `reason` (shown to Claude
 *   next to the tool result) and still exits 0 — the docs say to choose JSON
 *   or exit codes per hook, not both.
 * - Claude Code caps each string at 10,000 chars; we truncate to a budget
 *   (default 8,000) so the whole message is always delivered inline.
 */
import type { AgentEvent, ClaudeHookEventName, ClaudeHookOutput } from '../contracts/agent.js';

export const DEFAULT_BUDGET_CHARS = 8000;
export const MAX_BUDGET_CHARS = 9500;

export function hookEventNameFor(event: AgentEvent, hookEventName?: string): ClaudeHookEventName {
  if (hookEventName === 'SessionStart' || hookEventName === 'UserPromptSubmit' || hookEventName === 'PostToolUse') {
    return hookEventName;
  }
  if (event === 'session_start' || event === 'compact') return 'SessionStart';
  if (event === 'post_edit') return 'PostToolUse';
  return 'UserPromptSubmit';
}

export function truncateToBudget(text: string, budget = DEFAULT_BUDGET_CHARS): string {
  const limit = Math.min(Math.max(budget, 200), MAX_BUDGET_CHARS);
  if (text.length <= limit) return text;
  const note = '\n… (FlowLens output truncated; raise --budget or lower --max-items)';
  const cut = text.lastIndexOf('\n', limit - note.length);
  return `${text.slice(0, cut > 0 ? cut : limit - note.length)}${note}`;
}

export function contextOutput(
  eventName: ClaudeHookEventName,
  text: string,
  options: { budget?: number; systemMessage?: string } = {},
): ClaudeHookOutput {
  const output: ClaudeHookOutput = {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: truncateToBudget(text, options.budget) },
  };
  if (options.systemMessage) output.systemMessage = options.systemMessage;
  return output;
}

export function blockOutput(reason: string, text: string, budget?: number): ClaudeHookOutput {
  return {
    decision: 'block',
    reason: truncateToBudget(reason, budget),
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: truncateToBudget(text, budget) },
  };
}

export function printHookOutput(output: ClaudeHookOutput | null): void {
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}
