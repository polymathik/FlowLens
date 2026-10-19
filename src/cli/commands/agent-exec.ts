import type { AgentCommandResult } from '../../contracts/agent.js';
import { AgentUsageError } from '../../agent/options.js';
import { ClaudeSettingsError } from '../../agent/settings-file.js';

export function done(stdout: string): AgentCommandResult {
  return { exit_code: 0, stdout, stderr: '' };
}

/** Run a command body; usage/settings errors exit 2 with a message, nothing written. */
export async function execute(body: () => Promise<AgentCommandResult>): Promise<void> {
  let result: AgentCommandResult;
  try {
    result = await body();
  } catch (err) {
    if (err instanceof AgentUsageError || err instanceof ClaudeSettingsError) {
      result = { exit_code: 2, stdout: '', stderr: `flowlens agent: ${err.message}` };
    } else {
      throw err;
    }
  }
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exit_code;
}
