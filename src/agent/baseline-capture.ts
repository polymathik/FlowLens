/**
 * Capture a strict-mode baseline when none exists for the current HEAD,
 * robust to a concurrent re-index (wave 2: with `serve --watch`, the
 * daemon's watcher may index the agent's edit before the guard runs, so
 * "the current graph" can already contain the very issue being guarded).
 *
 * Sources, first usable wins — each must have been read BEFORE the earliest
 * changed file was last modified, so it cannot contain the edit:
 *   1. the graph snapshot stored for HEAD (`flowlens snapshot` / index);
 *   2. the agent digest (fresh or stale);
 *   3. the current graph, minus every issue touching the changed files —
 *      conservative: a pre-existing cycle through an edited file then counts
 *      as new (a possible false block), never a silent pass.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBaseline } from '../contracts/agent.js';
import type { GraphStore } from '../contracts/graph.js';
import { SnapshotManager } from '../analysis/snapshot-manager.js';
import { loadBaseline, makeBaseline, saveBaseline } from './baseline.js';
import { computeGraphIssues, type AgentGraphDigest, type GraphIssues } from './digest.js';
import { InMemoryGraph } from './memory-graph.js';

export interface CaptureInput {
  rootDir: string;
  flowlensDir: string;
  head: string | null;
  /** Latest digest, fresh or stale. */
  digest: AgentGraphDigest | null;
  /** Live graph, BEFORE the guard re-indexes. */
  graph: GraphStore;
  changedFiles: string[];
}

/** Existing baseline for HEAD, else a newly captured (and saved) one when `capture`. */
export async function ensureGuardBaseline(input: CaptureInput, capture: boolean): Promise<AgentBaseline | null> {
  const existing = await loadBaseline(input.flowlensDir, input.head);
  if (existing || !capture) return existing;
  const baseline = await captureBaseline(input);
  try {
    await saveBaseline(input.flowlensDir, baseline);
  } catch {
    // still use it for this run
  }
  return baseline;
}

export async function captureBaseline(input: CaptureInput): Promise<AgentBaseline> {
  const editedAt = earliestMtime(input.rootDir, input.changedFiles);
  const before = (iso: string | number | undefined) =>
    iso !== undefined && (typeof iso === 'number' ? iso : Date.parse(iso)) < editedAt;

  if (input.head) {
    const snapshot = await new SnapshotManager(join(input.flowlensDir, 'snapshots')).loadSnapshot(input.head).catch(() => null);
    if (snapshot && before(snapshot.timestamp)) {
      const issues = await computeGraphIssues(new InMemoryGraph(snapshot.entities, snapshot.relations), input.flowlensDir);
      return fromIssues(input.head, 'snapshot', issues);
    }
  }
  const digest = input.digest;
  if (digest && before(digest.read_at ?? digest.computed_at)) {
    return makeBaseline(input.head, 'guard', digest.cycle_keys, digest.violation_ids);
  }
  const issues = await computeGraphIssues(input.graph, input.flowlensDir);
  const changed = new Set(input.changedFiles);
  return fromIssues(input.head, 'guard', {
    cycles: issues.cycles.filter((cycle) => !cycle.entities.some((file) => changed.has(file))),
    violations: issues.violations.filter((violation) => !changed.has(violation.file)),
    warnings: issues.warnings,
  });
}

function fromIssues(head: string | null, source: AgentBaseline['source'], issues: GraphIssues): AgentBaseline {
  return makeBaseline(head, source, issues.cycles.map((cycle) => cycle.entities), issues.violations.map((v) => v.id));
}

/** Earliest mtime among changed files (deleted files count as "now"). */
function earliestMtime(rootDir: string, files: string[]): number {
  let min = Date.now();
  for (const file of files) {
    try {
      min = Math.min(min, statSync(join(rootDir, file)).mtimeMs);
    } catch {
      // deleted: no mtime
    }
  }
  return min;
}
