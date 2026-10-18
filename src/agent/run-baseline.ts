/** `flowlens agent baseline [--reset]`: inspect or re-capture the strict-mode baseline. */
import type { AgentBaseline, AgentCommandResult, AgentOutputFormat } from '../contracts/agent.js';
import { baselinePath, loadBaseline, makeBaseline, saveBaseline } from './baseline.js';
import { getGitHead } from './changed-files.js';
import { flowlensDirFor } from './graph-access.js';
import { resolveDigest } from './run-context.js';

export async function runAgentBaseline(options: {
  rootDir: string;
  reset: boolean;
  format: AgentOutputFormat;
}): Promise<AgentCommandResult> {
  const flowlensDir = flowlensDirFor(options.rootDir);
  const head = getGitHead(options.rootDir);
  let baseline: AgentBaseline | null;
  if (options.reset) {
    const resolution = await resolveDigest(options.rootDir);
    if (!resolution.ok) return { exit_code: 1, stdout: '', stderr: resolution.message };
    baseline = makeBaseline(head, 'manual', resolution.digest.cycle_keys, resolution.digest.violation_ids);
    await saveBaseline(flowlensDir, baseline);
  } else {
    baseline = await loadBaseline(flowlensDir, head);
  }
  if (options.format === 'json') {
    return { exit_code: 0, stdout: JSON.stringify({ path: baselinePath(flowlensDir), baseline }, null, 2), stderr: '' };
  }
  const text = baseline
    ? [
      `Baseline for ${head ?? 'no-git'} (${baseline.source}, ${baseline.created_at})`,
      `Cycles: ${baseline.cycles.length}; violations: ${baseline.violation_ids.length}`,
      `File: ${baselinePath(flowlensDir)}`,
    ].join('\n')
    : `No baseline for ${head ?? 'no-git'} yet. It is captured at SessionStart or on the first \`agent guard --reindex\`; run \`flowlens agent baseline --reset\` to capture it now.`;
  return { exit_code: 0, stdout: text, stderr: '' };
}
