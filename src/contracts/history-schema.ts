/**
 * zod schemas for the history boundaries (Node / API side): the two cache
 * files read back from disk and the topology build request body. The pure
 * analysis helpers never import this file (no zod in the browser bundle).
 */
import { z } from 'zod';
import {
  HISTORY_MAX_LIMIT, TOPOLOGY_MAX_SAMPLES,
  type HistoryCommitsCache, type HistoryTopology, type TopologyBuildOptions,
} from './history.js';

const sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const count = z.number().int().min(0).max(2_000_000_000);

const fileChange = z.object({
  path: z.string().min(1),
  status: z.enum(['A', 'M', 'D', 'R']),
  from: z.string().min(1).optional(),
  added: count,
  deleted: count,
});

const commit = z.object({
  sha,
  parents: z.array(sha).max(64),
  date: z.string(),
  author: z.string(),
  subject: z.string(),
  files: z.array(fileChange),
});

const commitsCache = z.object({
  version: z.literal(1),
  head: sha,
  branch: z.string(),
  commits: z.array(commit),
  truncated: z.boolean(),
  totals: z.object({
    commits: count, files_ever: count, first_date: z.string().nullable(), last_date: z.string().nullable(),
  }),
  built_at: z.string(),
  shallow: z.boolean().optional(),
  baseline: z.array(z.string()).optional(),
  first_parent: z.boolean().optional(),
  max: z.number().int().min(1),
  filter_key: z.string(),
});

const topologySample = z.object({
  sha,
  date: z.string(),
  files: z.array(count),
  edges: z.array(z.tuple([count, count, count])),
});

const topologyCache = z.object({
  version: z.literal(1),
  head: sha,
  samples: z.array(topologySample),
  files: z.array(z.string()),
  every: z.number().int().min(1),
  capped: z.boolean(),
  skipped: z.array(z.object({ sha, reason: z.string() })),
  built_at: z.string(),
  filter_key: z.string(),
});

/** Parse a cache document; `null` when it is not a valid current-version document (callers rebuild). */
export function parseCommitsCache(raw: unknown): HistoryCommitsCache | null {
  const r = commitsCache.safeParse(raw);
  return r.success ? (r.data as HistoryCommitsCache) : null;
}

export function parseTopologyCache(raw: unknown): HistoryTopology | null {
  const r = topologyCache.safeParse(raw);
  if (!r.success) return null;
  const t = r.data as HistoryTopology;
  const n = t.files.length;
  // Indices must point into the string table.
  const ok = t.samples.every((s) => s.files.every((i) => i < n) && s.edges.every(([a, b]) => a < n && b < n));
  return ok ? t : null;
}

const buildBody = z.object({
  every: z.number().int().min(1).max(HISTORY_MAX_LIMIT).optional(),
  max: z.number().int().min(2).max(TOPOLOGY_MAX_SAMPLES).optional(),
});

export type ParsedBuildBody = { ok: true; value: TopologyBuildOptions } | { ok: false; message: string };

/** Validate the `POST …/topology/build` body (an absent body means defaults). */
export function parseTopologyBuildBody(raw: unknown): ParsedBuildBody {
  const r = buildBody.safeParse(raw ?? {});
  if (r.success) return { ok: true, value: r.data };
  const i = r.error.issues[0];
  return { ok: false, message: `Invalid build request: ${i?.path.join('.') || '(body)'} ${i?.message ?? ''}`.trim() };
}
