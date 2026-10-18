import type { ArchitectureConfig } from '../contracts/architecture.js';
import { describeArchConfigProblem, loadArchConfig } from '../analysis/arch-config.js';

/**
 * architecture.json for agent analysis via the single validated loader.
 * Missing → no layer checks, silently; invalid → no layer checks, with a
 * warning (never silently "0 violations" on a broken file).
 */
export async function loadAgentArchitecture(
  flowlensDir: string,
): Promise<{ config: ArchitectureConfig | null; warning?: string }> {
  const result = await loadArchConfig(flowlensDir);
  if (result.status === 'ok') return { config: result.config };
  if (result.status === 'missing') return { config: null };
  return { config: null, warning: `${describeArchConfigProblem(result)}; layer checks skipped.` };
}
