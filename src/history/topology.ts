/**
 * Sampled topology: file-to-file dependency edges at a handful of commits,
 * built without ever checking anything out.
 *
 * ```mermaid
 * flowchart TD
 *   S[HistorySummary.commits] --> P[planSamples: 0, e, 2e … + HEAD, at most max]
 *   P --> R{sha already stored<br/>same filter + parser?}
 *   R -- yes --> U[reuse stored sample]
 *   R -- no --> X[git ls-tree + cat-file → temp dir<br/>only indexable files]
 *   X --> I[discover → parse → pass 2<br/>in-memory, no .flowlens writes]
 *   I --> E[keep import / call / extend / implement<br/>file→file edges, weights summed]
 *   E --> D[delete temp dir]
 *   X -. failure, timeout, too big .-> K[skip sample, record reason]
 *   U --> T[string table + index pairs]
 *   D --> T
 *   T --> C{over size cap?}
 *   C -- yes --> Z[drop every other interior sample, capped = true]
 *   C -- no --> W[atomic write topology.json]
 *   Z --> W
 * ```
 *
 * Cost: one sample ≈ the cost of a cold index of that tree minus the graph
 * writes (see the phase doc for measured numbers). Every sample is bounded
 * by a time limit, a size limit and a file-count limit.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HistoryError, TOPOLOGY_MAX_FILES_PER_SAMPLE, TOPOLOGY_MAX_STORE_BYTES, TOPOLOGY_SAMPLE_MAX_BYTES, TOPOLOGY_SAMPLE_TIMEOUT_MS,
  type HistoryCommit, type HistorySkippedSample, type HistoryTopology, type HistoryTopologySample, type TopologyBuildOptions,
  type TopologyProgress,
} from '../contracts/history.js';
import { PARSER_VERSION } from '../manifest/version.js';
import { readTopologyCache, writeTopologyCache } from './cache.js';
import { Deadline } from './deadline.js';
import type { HistoryFileFilter } from './file-filter.js';
import { sampleGraph } from './sample-edges.js';
import { pickSamples, planSamples } from './sample-select.js';
import { exportTree } from './tree-export.js';

export interface BuildTopologyInput extends TopologyBuildOptions {
  rootDir: string;
  flowlensDir: string;
  filter: HistoryFileFilter;
  /** The history the samples are drawn from (oldest → newest). */
  head: string;
  commits: HistoryCommit[];
  signal?: AbortSignal;
  onProgress?: (p: TopologyProgress) => void;
  sampleTimeoutMs?: number;
  sampleMaxBytes?: number;
  /** Serialised-size cap of topology.json (default `TOPOLOGY_MAX_STORE_BYTES`). */
  maxStoreBytes?: number;
  /** Directory for temporary trees (default: the OS temp dir). */
  tmpRoot?: string;
  /** Called with each sample's timing (benchmarks, logs). */
  onSample?: (info: { sha: string; ms: number; files: number; edges: number; reused: boolean }) => void;
}

interface PathSample { sha: string; date: string; files: string[]; edges: Array<[string, string, number]> }

/** Cache key: samples are only comparable when produced by the same filter and parser. */
export const topologyKey = (filter: HistoryFileFilter): string => `${filter.key}:${PARSER_VERSION}`;

function decode(t: HistoryTopology, s: HistoryTopologySample): PathSample {
  return { sha: s.sha, date: s.date, files: s.files.map((i) => t.files[i]), edges: s.edges.map(([a, b, w]) => [t.files[a], t.files[b], w]) };
}

function encode(samples: PathSample[]): Pick<HistoryTopology, 'samples' | 'files'> {
  const table = new Map<string, number>();
  const id = (p: string): number => {
    let i = table.get(p);
    if (i === undefined) table.set(p, (i = table.size));
    return i;
  };
  const out = samples.map((s): HistoryTopologySample => ({
    sha: s.sha, date: s.date, files: s.files.map(id), edges: s.edges.map(([a, b, w]) => [id(a), id(b), w]),
  }));
  return { samples: out, files: [...table.keys()] };
}

/** Drop every other interior sample until the document fits. */
function fit(samples: PathSample[], meta: Omit<HistoryTopology, 'samples' | 'files' | 'capped'>, maxBytes: number): { doc: HistoryTopology; thinned: boolean } {
  let kept = samples;
  let thinned = false;
  for (;;) {
    const doc: HistoryTopology = { ...meta, ...encode(kept), capped: thinned };
    if (kept.length <= 2 || JSON.stringify(doc).length <= maxBytes) return { doc, thinned };
    kept = kept.filter((_, i) => i === 0 || i === kept.length - 1 || i % 2 === 0);
    thinned = true;
  }
}

async function sampleOne(o: BuildTopologyInput, c: HistoryCommit): Promise<PathSample> {
  const dir = await mkdtemp(join(o.tmpRoot ?? tmpdir(), 'flowlens-hist-'));
  const deadline = new Deadline(o.sampleTimeoutMs ?? TOPOLOGY_SAMPLE_TIMEOUT_MS, o.signal, c.sha.slice(0, 8));
  try {
    await exportTree({
      rootDir: o.rootDir, sha: c.sha, dest: dir, filter: o.filter, deadline, signal: o.signal,
      maxBytes: o.sampleMaxBytes ?? TOPOLOGY_SAMPLE_MAX_BYTES, maxFiles: TOPOLOGY_MAX_FILES_PER_SAMPLE,
    });
    const g = await sampleGraph(dir, o.filter, deadline);
    return { sha: c.sha, date: c.date, files: g.files, edges: g.edges };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build (or incrementally refresh) `.flowlens/history/topology.json`.
 * Cancellation (`signal`) rejects with `HistoryError('aborted')` and writes nothing.
 * A sample that fails or times out is skipped and recorded; two timeouts in a
 * row stop the build early (a timed-out parse cannot be killed, so continuing
 * would only pile up work) and mark the result `capped`.
 */
export async function buildTopology(o: BuildTopologyInput): Promise<HistoryTopology> {
  const plan = planSamples(o.commits.length, { every: o.every, max: o.max });
  const key = topologyKey(o.filter);
  const previous = await readTopologyCache(o.flowlensDir);
  const stored = new Map<string, PathSample>();
  if (previous && previous.filter_key === key) for (const s of previous.samples) stored.set(s.sha, decode(previous, s));

  const indexOf = new Map(o.commits.map((c, i) => [c.sha, i]));
  const storedAt = new Set([...stored.keys()].flatMap((sha) => (indexOf.has(sha) ? [indexOf.get(sha) as number] : [])));
  const picks = pickSamples(plan, storedAt);
  const progress: TopologyProgress = { done: 0, total: picks.length, reused: 0, skipped: 0, current: null };
  const emit = (): void => o.onProgress?.({ ...progress });
  emit();
  const samples: PathSample[] = [];
  const skipped: HistorySkippedSample[] = [];
  let stoppedEarly = false;
  let timeoutsInARow = 0;

  for (const { index } of picks) {
    if (o.signal?.aborted) throw new HistoryError('aborted', 'Topology build was cancelled');
    const commit = o.commits[index];
    progress.current = commit.sha;
    emit();
    const hit = stored.get(commit.sha);
    const t0 = Date.now();
    if (hit) {
      samples.push(hit);
      progress.reused++;
      o.onSample?.({ sha: commit.sha, ms: 0, files: hit.files.length, edges: hit.edges.length, reused: true });
    } else {
      try {
        const s = await sampleOne(o, commit);
        samples.push(s);
        timeoutsInARow = 0;
        o.onSample?.({ sha: commit.sha, ms: Date.now() - t0, files: s.files.length, edges: s.edges.length, reused: false });
      } catch (err) {
        if (err instanceof HistoryError && err.code === 'aborted') throw err;
        const timedOut = err instanceof HistoryError && err.code === 'timeout';
        skipped.push({ sha: commit.sha, reason: err instanceof Error ? err.message.slice(0, 300) : String(err) });
        progress.skipped++;
        timeoutsInARow = timedOut ? timeoutsInARow + 1 : 0;
        if (timeoutsInARow >= 2) stoppedEarly = true;
      }
    }
    progress.done++;
    if (stoppedEarly) break;
  }
  progress.current = null;
  emit();

  const { doc, thinned } = fit(samples, {
    version: 1, head: o.head, every: plan.every, skipped, built_at: new Date().toISOString(), filter_key: key,
  }, o.maxStoreBytes ?? TOPOLOGY_MAX_STORE_BYTES);
  doc.capped = plan.capped || thinned || stoppedEarly;
  await writeTopologyCache(o.flowlensDir, doc);
  return doc;
}
