/**
 * History contract (Map v2, M5a): the repo's growth over time, without
 * parsing any source.
 *
 * Two layers, both produced by `src/history/**` and cached under
 * `<project>/.flowlens/history/`:
 *
 *  1. `HistorySummary` — cheap: `git log --name-status --numstat` per commit
 *     (adds, deletes, renames, LOC), filtered to the files the map shows.
 *  2. `HistoryTopology` — sampled: file-to-file dependency edges at ≤25
 *     commits (parsed from `git archive`, never from the working tree).
 *
 * Privacy: only author *names* are stored or served, never e-mail addresses.
 * Pure consumers (`src/analysis/history/**`, the timeline UI) import only
 * this file; Node-only code (git, caches, routes) lives elsewhere.
 */

/** A → added, M → modified (incl. mode/type change), D → deleted, R → renamed (`from` is the old path). */
export type HistoryChangeStatus = 'A' | 'M' | 'D' | 'R';

export interface HistoryFileChange {
  /** Project-relative, `/`-separated. For `D` the path that was removed; for `R` the new path. */
  path: string;
  status: HistoryChangeStatus;
  /** Old path of a rename (only with status `R`). */
  from?: string;
  /** Lines added / deleted (binary files: 0 / 0). */
  added: number;
  deleted: number;
}

export interface HistoryCommit {
  /** Full commit id. */
  sha: string;
  parents: string[];
  /** Committer date, ISO 8601 (`%cI`). */
  date: string;
  /** Author name only. */
  author: string;
  subject: string;
  /** Changes to files the map shows (supported extensions, not ignored); empty for e.g. docs-only commits. */
  files: HistoryFileChange[];
}

export interface HistoryTotals {
  commits: number;
  /** Distinct file paths ever seen in the window (renames count once per path). */
  files_ever: number;
  first_date: string | null;
  last_date: string | null;
}

/** How the summary was produced by the call that returned it (informational). */
export interface HistoryBuildInfo {
  mode: 'cache' | 'incremental' | 'full';
  duration_ms: number;
  /** Commits read from git by this call (0 for `cache`). */
  commits_read: number;
}

export interface HistorySummary {
  /** Commit id of HEAD when this was built. */
  head: string;
  /** Current branch name, or `HEAD` when detached. */
  branch: string;
  /** Oldest → newest. */
  commits: HistoryCommit[];
  /** True when older commits were left out (the `max` cap, the output byte cap or the time limit). */
  truncated: boolean;
  totals: HistoryTotals;
  /** ISO time the cache was last written. */
  built_at: string;
  /** `git rev-parse --is-shallow-repository`: the oldest commit may be a graft, not a real root. */
  shallow?: boolean;
  /**
   * Files that already existed before `commits[0]` (only when `truncated`): lets
   * the timeline start from the right file count. Their LOC is unknown (counted from 0).
   */
  baseline?: string[];
  /** `--first-parent` mode: merges are listed (diffed against their first parent) instead of the commits they bring in. */
  first_parent?: boolean;
  build?: HistoryBuildInfo;
}

/** On-disk shape of `.flowlens/history/commits.json`. */
export interface HistoryCommitsCache extends HistorySummary {
  version: 1;
  /** The `max` this cache was built with (a different request rebuilds). */
  max: number;
  /** Fingerprint of the file filter (ignore rules + extensions); a change rebuilds. */
  filter_key: string;
}

/** A sampled commit: its live files and file-to-file dependency edges. */
export interface HistoryTopologySample {
  sha: string;
  date: string;
  /** Indices into `HistoryTopology.files` of the files parsed at this commit. */
  files: number[];
  /** `[fromFile, toFile, weight]` — indices into the string table; weight = number of import/call/extend/implement relations. */
  edges: Array<[number, number, number]>;
}

export interface HistorySkippedSample {
  sha: string;
  reason: string;
}

export interface HistoryTopology {
  version: 1;
  head: string;
  /** Oldest → newest. */
  samples: HistoryTopologySample[];
  /** String table: every path used by any sample, once. */
  files: string[];
  /** Effective stride in commits between samples (1 = every commit). */
  every: number;
  /** True when a cap (sample count, total size) reduced what was asked for. */
  capped: boolean;
  /** Samples that failed or timed out (the build continued without them). */
  skipped: HistorySkippedSample[];
  built_at: string;
  /** Fingerprint of the file filter + parser the samples were produced with. */
  filter_key: string;
}

// ---- limits -----------------------------------------------------------------

export const HISTORY_SCHEMA_VERSION = 1;
export const HISTORY_DIR = 'history';
export const HISTORY_COMMITS_FILE = 'commits.json';
export const HISTORY_TOPOLOGY_FILE = 'topology.json';

export const HISTORY_DEFAULT_MAX = 2_000;
export const HISTORY_MAX_LIMIT = 20_000;
/** `git log` output beyond this is dropped (the newest commits are kept). */
export const HISTORY_DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
export const HISTORY_DEFAULT_TIMEOUT_MS = 120_000;
/** The baseline list is dropped (not truncated) above this many files. */
export const HISTORY_BASELINE_MAX_FILES = 50_000;

export const TOPOLOGY_DEFAULT_SAMPLES = 25;
export const TOPOLOGY_MAX_SAMPLES = 60;
export const TOPOLOGY_SAMPLE_TIMEOUT_MS = 90_000;
/** Unpacked archive size cap per sample. */
export const TOPOLOGY_SAMPLE_MAX_BYTES = 256 * 1024 * 1024;
/** Cap on `topology.json` (serialised); further samples are dropped and `capped` is set. */
export const TOPOLOGY_MAX_STORE_BYTES = 24 * 1024 * 1024;
/** Samples with more files than this are skipped (reason recorded). */
export const TOPOLOGY_MAX_FILES_PER_SAMPLE = 20_000;

// ---- errors -----------------------------------------------------------------

export type HistoryErrorCode =
  | 'not_a_git_repo' // the project root is not inside a git work tree
  | 'git_unavailable' // `git` could not be started
  | 'no_commits' // a git repo without a first commit
  | 'git_failed' // git exited with an error (message carries its stderr)
  | 'internal' // anything else (disk full, unwritable cache, …)
  | 'not_built' // topology requested before any build
  | 'job_running' // a topology job is already running for this project
  | 'bad_request'
  | 'aborted'
  | 'timeout';

/** HTTP status per code (the `not_found`/auth errors of the daemon keep their own bodies). */
export const HISTORY_ERROR_STATUS: Record<HistoryErrorCode, number> = {
  not_a_git_repo: 404,
  git_unavailable: 500,
  no_commits: 404,
  git_failed: 500,
  internal: 500,
  not_built: 404,
  job_running: 409,
  bad_request: 400,
  aborted: 499,
  timeout: 504,
};

export interface HistoryErrorBody {
  ok: false;
  error: { code: HistoryErrorCode; message: string };
  /** `job_running`: the job in flight. */
  job_id?: string;
}

/** Thrown by `src/history/**`; the routes turn it into a `HistoryErrorBody`. */
export class HistoryError extends Error {
  constructor(public readonly code: HistoryErrorCode, message: string, public readonly jobId?: string) {
    super(message);
    this.name = 'HistoryError';
  }
}

// ---- options ----------------------------------------------------------------

export interface HistoryBuildOptions {
  /** Newest commits to keep (default `HISTORY_DEFAULT_MAX`, ≤ `HISTORY_MAX_LIMIT`). */
  max?: number;
  /** List merges (diffed against their first parent) instead of the commits they bring in. */
  firstParent?: boolean;
}

export interface TopologyBuildOptions {
  /** Sample every N-th commit (counted from the oldest); default: chosen so that ≤ `max` samples result. */
  every?: number;
  /** Most samples (default 25, ≤ `TOPOLOGY_MAX_SAMPLES`). The first commit and HEAD are always included. */
  max?: number;
}

// ---- REST -------------------------------------------------------------------

/**
 * Routes (per project; same auth as the other canvas routes: bearer token or
 * explorer session cookie; DELETE and POST from a browser need a same-origin `Origin`).
 *
 *   GET    {history}                    → HistorySummary          (200) | HistoryErrorBody (404 not_a_git_repo / no_commits, …)
 *            ?max=N&first_parent=1        builds or incrementally updates the cache on demand
 *   GET    {topology}                   → HistoryTopology         (200) | HistoryErrorBody (404 not_built)
 *   POST   {topologyBuild} {every?,max?} → TopologyBuildStarted    (202) | HistoryErrorBody (409 job_running, 404 not_a_git_repo)
 *   GET    {topologyStatus}             → TopologyJobStatus       (200, `state: 'idle'` when no job ran)
 *   DELETE {topologyBuild}              → TopologyJobStatus       (200, cancels the running job)
 *   DELETE {history}                    → { ok: true, removed: string[] } (cancels a job, deletes both caches)
 */
export const HISTORY_ROUTES = {
  history: '/api/projects/:id/canvas/history',
  topology: '/api/projects/:id/canvas/history/topology',
  topologyBuild: '/api/projects/:id/canvas/history/topology/build',
  topologyStatus: '/api/projects/:id/canvas/history/topology/status',
} as const;

/** Body cap of the (tiny) build request. */
export const HISTORY_BUILD_BODY_MAX_BYTES = 4 * 1024;

export type TopologyJobState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TopologyProgress {
  /** Samples finished (stored, reused or skipped). */
  done: number;
  total: number;
  /** Of `done`: taken from the existing cache. */
  reused: number;
  skipped: number;
  /** Sha being parsed right now. */
  current: string | null;
}

export interface TopologyJobStatus {
  ok: true;
  state: TopologyJobState;
  job_id: string | null;
  progress: TopologyProgress | null;
  started_at: string | null;
  finished_at: string | null;
  /** Set when `state` is `failed`. */
  error: { code: HistoryErrorCode; message: string } | null;
}

export interface TopologyBuildStarted {
  ok: true;
  job_id: string;
  status: TopologyJobStatus;
}

export interface HistoryClearResult {
  ok: true;
  removed: string[];
}
