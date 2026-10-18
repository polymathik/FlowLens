/**
 * HistoryService — what the daemon routes call. Per project it provides:
 *
 *  - `summary()`: the commit history, built or updated on demand. Concurrent
 *    callers share one build (single-flight) and a result is reused for
 *    `minIntervalMs` (rate limit; failures too, so a polling UI cannot make
 *    the daemon spawn git in a loop).
 *  - one topology job at a time, with progress, cancellation and typed failure.
 *  - `clear()`: cancel the job and delete both caches.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> idle
 *   idle --> running: startTopology
 *   running --> done: all samples handled
 *   running --> failed: error (not_a_git_repo, git_failed, …)
 *   running --> cancelled: cancel / clear
 *   done --> running: startTopology
 *   failed --> running: startTopology
 *   cancelled --> running: startTopology
 *   running --> running: startTopology → 409 job_running
 * ```
 */
import { randomBytes } from 'node:crypto';
import {
  HistoryError, type HistoryBuildOptions, type HistorySummary, type HistoryTopology, type TopologyBuildOptions,
  type TopologyJobStatus, type TopologyProgress,
} from '../contracts/history.js';
import { loadProjectConfig } from '../projects/config.js';
import { projectFlowlensDir } from '../projects/paths.js';
import { clearHistoryCaches, readTopologyCache } from './cache.js';
import { buildHistory, clampMax } from './commits.js';
import { loadFileFilter } from './file-filter.js';
import { buildTopology } from './topology.js';

export interface HistoryServiceOptions {
  /** Reuse a result this long without asking git again (default 1000 ms). */
  minIntervalMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  /** Test hooks: forwarded to the builders. */
  summaryLimits?: { maxBytes?: number; timeoutMs?: number };
  topologyLimits?: { sampleTimeoutMs?: number; sampleMaxBytes?: number };
}

export interface ProjectRef { id: string; root: string }

interface Job {
  id: string;
  state: TopologyJobStatus['state'];
  progress: TopologyProgress | null;
  started_at: string;
  finished_at: string | null;
  error: TopologyJobStatus['error'];
  controller: AbortController;
  done: Promise<void>;
}

interface ProjectState {
  chain: Promise<unknown>;
  inflight: Map<string, Promise<HistorySummary>>;
  last: { key: string; at: number; value?: HistorySummary; error?: HistoryError } | null;
  job: Job | null;
}

const IDLE: TopologyJobStatus = { ok: true, state: 'idle', job_id: null, progress: null, started_at: null, finished_at: null, error: null };

export class HistoryService {
  private readonly projects = new Map<string, ProjectState>();
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly o: HistoryServiceOptions = {}) {
    this.minIntervalMs = o.minIntervalMs ?? 1000;
    this.now = o.now ?? Date.now;
  }

  private state(p: ProjectRef): ProjectState {
    let s = this.projects.get(p.id);
    if (!s) this.projects.set(p.id, (s = { chain: Promise.resolve(), inflight: new Map(), last: null, job: null }));
    return s;
  }

  /** Build or refresh the history. Throws `HistoryError`. */
  summary(p: ProjectRef, opts: HistoryBuildOptions = {}): Promise<HistorySummary> {
    const s = this.state(p);
    const key = `${clampMax(opts.max)}:${opts.firstParent ? 1 : 0}`;
    const joined = s.inflight.get(key);
    if (joined) return joined;
    if (s.last && s.last.key === key && this.now() - s.last.at < this.minIntervalMs) {
      return s.last.error ? Promise.reject(s.last.error) : Promise.resolve(s.last.value as HistorySummary);
    }
    const run = s.chain.then(() => this.runSummary(p, s, key, opts));
    s.chain = run.catch(() => undefined); // builds with different options run one after another
    s.inflight.set(key, run);
    void run.then(() => s.inflight.delete(key), () => s.inflight.delete(key));
    return run;
  }

  private async runSummary(p: ProjectRef, s: ProjectState, key: string, opts: HistoryBuildOptions): Promise<HistorySummary> {
    try {
      const flowlensDir = projectFlowlensDir(p.root);
      const filter = await loadFileFilter(p.root, loadProjectConfig(p.root));
      const value = await buildHistory({ rootDir: p.root, flowlensDir, filter, ...opts, ...this.o.summaryLimits });
      s.last = { key, at: this.now(), value };
      if (value.build && value.build.mode !== 'cache') {
        this.o.log?.(`[history] ${p.id}: ${value.build.mode} build, ${value.build.commits_read} commits in ${value.build.duration_ms}ms`);
      }
      return value;
    } catch (err) {
      const e = err instanceof HistoryError ? err : new HistoryError('internal', err instanceof Error ? err.message : String(err));
      if (e.code !== 'aborted') s.last = { key, at: this.now(), error: e };
      throw e;
    }
  }

  /** The stored topology; `not_built` before the first job finished. */
  async topology(p: ProjectRef): Promise<HistoryTopology> {
    const t = await readTopologyCache(projectFlowlensDir(p.root));
    if (!t) throw new HistoryError('not_built', 'No topology yet: POST …/history/topology/build first');
    return t;
  }

  status(p: ProjectRef): TopologyJobStatus {
    const j = this.projects.get(p.id)?.job;
    if (!j) return IDLE;
    return {
      ok: true, state: j.state, job_id: j.id, progress: j.progress && { ...j.progress },
      started_at: j.started_at, finished_at: j.finished_at, error: j.error,
    };
  }

  /**
   * Start a topology job (history is refreshed first). Throws `job_running` when one is in flight;
   * validation of git/repo problems happens before the job exists, so those are thrown here too.
   */
  async startTopology(p: ProjectRef, opts: TopologyBuildOptions = {}): Promise<TopologyJobStatus> {
    const s = this.state(p);
    const running = (): Job | null => (s.job?.state === 'running' ? s.job : null);
    const busy = (): HistoryError => new HistoryError('job_running', 'A topology build is already running', running()?.id);
    if (running()) throw busy();
    const history = await this.summary(p);
    const filter = await loadFileFilter(p.root, loadProjectConfig(p.root));
    if (running()) throw busy(); // another start won while we awaited; no await between this check and `s.job = job`
    const controller = new AbortController();
    const job: Job = {
      id: randomBytes(6).toString('hex'), state: 'running', progress: null, started_at: new Date(this.now()).toISOString(),
      finished_at: null, error: null, controller, done: Promise.resolve(),
    };
    s.job = job;
    job.done = buildTopology({
      rootDir: p.root, flowlensDir: projectFlowlensDir(p.root), filter, head: history.head, commits: history.commits,
      ...opts, ...this.o.topologyLimits, signal: controller.signal,
      onProgress: (pr) => { job.progress = pr; },
    }).then(
      () => { job.state = 'done'; },
      (err: unknown) => {
        if (controller.signal.aborted || (err instanceof HistoryError && err.code === 'aborted')) job.state = 'cancelled';
        else {
          job.state = 'failed';
          job.error = { code: err instanceof HistoryError ? err.code : 'internal', message: err instanceof Error ? err.message : String(err) };
          this.o.log?.(`[history] ${p.id}: topology failed: ${job.error.message}`);
        }
      },
    ).finally(() => { job.finished_at = new Date(this.now()).toISOString(); });
    return this.status(p);
  }

  /** Abort the running job, if any. Resolves once it has stopped. */
  async cancel(p: ProjectRef): Promise<TopologyJobStatus> {
    const job = this.projects.get(p.id)?.job;
    if (job?.state === 'running') {
      job.controller.abort();
      await job.done;
    }
    return this.status(p);
  }

  /** Cancel the job and delete both caches; returns the cache files removed. */
  async clear(p: ProjectRef): Promise<string[]> {
    await this.cancel(p);
    const s = this.state(p);
    s.last = null;
    s.job = null;
    return clearHistoryCaches(projectFlowlensDir(p.root));
  }

  /** Daemon shutdown: stop every running job. */
  async dispose(): Promise<void> {
    await Promise.all([...this.projects.keys()].map((id) => this.cancel({ id, root: '' })));
  }

  /** Tests: wait for the running job (if any) to finish. */
  async idle(p: ProjectRef): Promise<void> {
    await this.projects.get(p.id)?.job?.done;
  }
}
