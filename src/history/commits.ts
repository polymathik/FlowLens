/**
 * Cheap history ingestion: `git log` → `HistorySummary`, cached at
 * `.flowlens/history/commits.json` and kept current incrementally.
 *
 * ```mermaid
 * flowchart TD
 *   A[buildHistory] --> P[probe: repo? HEAD, branch, shallow]
 *   P --> C{cache valid?<br/>same max, filter, mode}
 *   C -- no --> F[full: git log -n max+1, newest first]
 *   C -- yes --> H{cache.head == HEAD?}
 *   H -- yes --> R[serve cache]
 *   H -- no --> N{cache.head is an<br/>ancestor of HEAD?}
 *   N -- yes --> I[incremental: git log cache.head..HEAD]
 *   N -- no, history rewritten --> F
 *   I --> J{new commits >= max?}
 *   J -- yes --> F
 *   J -- no --> M[append, trim to max, fold dropped commits into baseline]
 *   F --> T[truncated? baseline = ls-tree of oldest kept commit's parent]
 *   M --> W[atomic write commits.json]
 *   T --> W
 * ```
 */
import { HISTORY_BASELINE_MAX_FILES, HISTORY_DEFAULT_MAX, HISTORY_MAX_LIMIT, HistoryError,
  type HistoryBuildOptions, type HistoryCommit, type HistoryCommitsCache, type HistorySummary } from '../contracts/history.js';
import { applyCommit, newReplayState } from '../analysis/history/replay.js';
import { readCommitsCache, writeCommitsCache } from './cache.js';
import type { HistoryFileFilter } from './file-filter.js';
import { gitText } from './git-run.js';
import { readLog } from './read-log.js';
import { isAncestor, probeRepo, type RepoProbe } from './repo-probe.js';

export interface BuildHistoryInput extends HistoryBuildOptions {
  rootDir: string;
  flowlensDir: string;
  filter: HistoryFileFilter;
  signal?: AbortSignal;
  /** Read limits (defaults in the contract); tests lower them. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Ignore the cache and read everything again. */
  force?: boolean;
}

export const clampMax = (max: number | undefined): number =>
  Math.max(1, Math.min(HISTORY_MAX_LIMIT, Math.trunc(max ?? HISTORY_DEFAULT_MAX)));

function totalsOf(commits: HistoryCommit[], baseline: string[] | undefined): HistorySummary['totals'] {
  const seen = new Set<string>(baseline);
  for (const c of commits) for (const f of c.files) { seen.add(f.path); if (f.from) seen.add(f.from); }
  return {
    commits: commits.length, files_ever: seen.size,
    first_date: commits[0]?.date ?? null, last_date: commits[commits.length - 1]?.date ?? null,
  };
}

/** Files present just before `sha` (its first parent's tree), filtered. */
async function baselineBefore(o: BuildHistoryInput, sha: string): Promise<string[] | undefined> {
  try {
    const out = await gitText(['ls-tree', '-r', '-z', '--name-only', `${sha}^1`], o.rootDir, { signal: o.signal, timeoutMs: 30_000 });
    const files = out.split('\0').filter((p) => p !== '' && o.filter.accepts(p));
    return files.length > HISTORY_BASELINE_MAX_FILES ? undefined : files;
  } catch (err) {
    if (err instanceof HistoryError && (err.code === 'aborted' || err.code === 'git_unavailable')) throw err;
    return undefined; // no parent (root/shallow graft) or not readable
  }
}

function assemble(
  o: BuildHistoryInput, probe: RepoProbe, max: number, commits: HistoryCommit[], truncated: boolean, baseline: string[] | undefined,
): HistoryCommitsCache {
  return {
    version: 1, head: probe.head, branch: probe.branch, commits, truncated,
    totals: totalsOf(commits, baseline), built_at: new Date().toISOString(), shallow: probe.shallow,
    ...(baseline && baseline.length > 0 ? { baseline } : {}),
    ...(o.firstParent ? { first_parent: true } : {}),
    max, filter_key: o.filter.key,
  };
}

async function fullBuild(o: BuildHistoryInput, probe: RepoProbe, max: number): Promise<{ doc: HistoryCommitsCache; read: number }> {
  const res = await readLog({ ...o, head: probe.head, limit: max + 1, scoped: probe.prefix !== '', accepts: o.filter.accepts });
  const read = res.commits.length;
  let newest = res.commits;
  let truncated = res.stopped;
  if (newest.length > max) { newest = newest.slice(0, max); truncated = true; }
  const commits = [...newest].reverse();
  const oldest = commits[0];
  const baseline = truncated && oldest && oldest.parents.length > 0 ? await baselineBefore(o, oldest.sha) : undefined;
  return { doc: assemble(o, probe, max, commits, truncated, baseline), read };
}

async function incremental(
  o: BuildHistoryInput, probe: RepoProbe, max: number, cache: HistoryCommitsCache,
): Promise<{ doc: HistoryCommitsCache; read: number } | null> {
  const res = await readLog({ ...o, head: probe.head, since: cache.head, limit: max, scoped: probe.prefix !== '', accepts: o.filter.accepts });
  if (res.stopped || res.commits.length >= max) return null; // too much changed: start over
  const all = [...cache.commits, ...[...res.commits].reverse()];
  const drop = Math.max(0, all.length - max);
  if (drop === 0) return { doc: assemble(o, probe, max, all, cache.truncated, cache.baseline), read: res.commits.length };
  const state = newReplayState(cache.baseline ?? []);
  all.slice(0, drop).forEach((c, i) => applyCommit(state, c, i, true));
  const baseline = [...state.live.keys()];
  return { doc: assemble(o, probe, max, all.slice(drop), true, baseline.length > HISTORY_BASELINE_MAX_FILES ? undefined : baseline), read: res.commits.length };
}

/** The served shape: cache bookkeeping (`version`, `max`, `filter_key`) stays on disk. */
export function toSummary(doc: HistoryCommitsCache, build?: HistorySummary['build']): HistorySummary {
  const { version: _v, max: _m, filter_key: _f, ...summary } = doc;
  return build ? { ...summary, build } : summary;
}

const reusable = (c: HistoryCommitsCache | null, o: BuildHistoryInput, max: number): c is HistoryCommitsCache =>
  !!c && c.max === max && c.filter_key === o.filter.key && !!c.first_parent === !!o.firstParent;

/**
 * Build or refresh the history of a project. Throws `HistoryError`
 * (`not_a_git_repo`, `no_commits`, `git_failed`, `aborted`, …).
 */
export async function buildHistory(o: BuildHistoryInput): Promise<HistorySummary> {
  const t0 = Date.now();
  const max = clampMax(o.max);
  const probe = await probeRepo(o.rootDir, o.signal);
  const cache = o.force ? null : await readCommitsCache(o.flowlensDir);
  const usable = reusable(cache, o, max) ? cache : null;
  const info = (mode: 'cache' | 'incremental' | 'full', read: number): HistorySummary['build'] =>
    ({ mode, duration_ms: Date.now() - t0, commits_read: read });

  if (usable && usable.head === probe.head) return toSummary({ ...usable, branch: probe.branch }, info('cache', 0));

  let built: { doc: HistoryCommitsCache; read: number } | null = null;
  let mode: 'incremental' | 'full' = 'incremental';
  if (usable && (await isAncestor(o.rootDir, usable.head, probe.head, o.signal))) built = await incremental(o, probe, max, usable);
  if (!built) { mode = 'full'; built = await fullBuild(o, probe, max); }
  await writeCommitsCache(o.flowlensDir, built.doc);
  return toSummary(built.doc, info(mode, built.read));
}
