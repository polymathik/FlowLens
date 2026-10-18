/**
 * Strict-mode attribution baseline at `.flowlens/agent-baseline.json`.
 *
 * A baseline records every file-level cycle and architecture violation at a
 * known-good point, keyed by git HEAD: written at SessionStart (from the
 * digest) or, if missing, by the guard BEFORE it re-indexes the edited files
 * (so the edit itself is not baked into the baseline). The guard then treats
 * only issues absent from the baseline as "new". Wave 2 can swap the source
 * for the graph manifest/snapshots by replacing `loadBaseline`/`saveBaseline`.
 */
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentBaseline,
  AgentBaselineFile,
  AgentCycleReference,
  AgentViolationReference,
} from '../contracts/agent.js';

const BASELINE_FILE = 'agent-baseline.json';
const MAX_BASELINES = 5;
export const NO_GIT_KEY = 'no-git';

export function baselinePath(flowlensDir: string): string {
  return join(flowlensDir, BASELINE_FILE);
}

export async function loadBaselineFile(flowlensDir: string): Promise<AgentBaselineFile> {
  const path = baselinePath(flowlensDir);
  if (!existsSync(path)) return { version: 1, baselines: {} };
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as AgentBaselineFile;
    if (parsed.version === 1 && parsed.baselines && typeof parsed.baselines === 'object') return parsed;
  } catch {
    // corrupt baseline: start over
  }
  return { version: 1, baselines: {} };
}

export async function loadBaseline(flowlensDir: string, gitHead: string | null): Promise<AgentBaseline | null> {
  const file = await loadBaselineFile(flowlensDir);
  return file.baselines[gitHead ?? NO_GIT_KEY] ?? null;
}

export async function saveBaseline(flowlensDir: string, baseline: AgentBaseline): Promise<void> {
  const file = await loadBaselineFile(flowlensDir);
  file.baselines[baseline.git_head ?? NO_GIT_KEY] = baseline;
  const keys = Object.keys(file.baselines)
    .sort((a, b) => file.baselines[b].created_at.localeCompare(file.baselines[a].created_at));
  for (const key of keys.slice(MAX_BASELINES)) delete file.baselines[key];
  const path = baselinePath(flowlensDir);
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
  await rename(tmp, path);
}

export function makeBaseline(
  gitHead: string | null,
  source: AgentBaseline['source'],
  cycleKeys: string[][],
  violationIds: string[],
): AgentBaseline {
  return {
    git_head: gitHead,
    created_at: new Date().toISOString(),
    source,
    cycles: cycleKeys.map((key) => [...key].sort()),
    violation_ids: [...new Set(violationIds)].sort(),
  };
}

export interface Attributed<T> {
  fresh: T[];
  preexisting: T[];
}

/**
 * A cycle is pre-existing when its file set equals, or is contained in, a
 * baseline cycle (a cycle that shrank is not a regression). A cycle that grew
 * or newly appeared is "new".
 */
export function attributeCycles(
  cycles: AgentCycleReference[],
  baseline: AgentBaseline | null,
): Attributed<AgentCycleReference> {
  if (!baseline) return { fresh: cycles, preexisting: [] };
  const sets = baseline.cycles.map((files) => new Set(files));
  const result: Attributed<AgentCycleReference> = { fresh: [], preexisting: [] };
  for (const cycle of cycles) {
    const known = sets.some((set) => cycle.entities.every((file) => set.has(file)));
    (known ? result.preexisting : result.fresh).push(cycle);
  }
  return result;
}

export function attributeViolations(
  violations: AgentViolationReference[],
  baseline: AgentBaseline | null,
): Attributed<AgentViolationReference> {
  if (!baseline) return { fresh: violations, preexisting: [] };
  const known = new Set(baseline.violation_ids);
  const result: Attributed<AgentViolationReference> = { fresh: [], preexisting: [] };
  for (const violation of violations) {
    (known.has(violation.id) ? result.preexisting : result.fresh).push(violation);
  }
  return result;
}
