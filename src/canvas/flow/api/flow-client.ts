/**
 * Flow REST client (routes: `FLOW_ROUTES` in contracts/flow-constants.ts, served per project next to the
 * other canvas routes). Errors come back as a `FlowApiError` with the machine code (`not_found`,
 * `ambiguous`, `bad_request`), the did-you-mean `suggestions` and the `candidates` of an ambiguous name.
 *
 * The daemon may be re-indexing when a request arrives (the graph is reopened for a moment): a 5xx or a
 * dropped connection is retried once after a short pause before it is reported.
 */
import type { EntryPoint, FlowEntryPointsResponse, FlowErrorBody, FlowTrace } from '../../../contracts/flow.js';
import { FLOW_LIMITS } from '../../../contracts/flow-constants.js';
import type { FlowSpec } from '../../../contracts/canvas/index.js';
import { ApiError, requestJson } from '../../api/http';

export class FlowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly candidates: NonNullable<FlowErrorBody['candidates']> = [],
    readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'FlowApiError';
  }
}

const RETRY_PAUSE_MS = 600;

function asFlowError(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err;
  const body = (err.body ?? {}) as Partial<FlowErrorBody>;
  return new FlowApiError(err.message, err.status, err.code ?? 'error', body.candidates ?? [], body.suggestions ?? []);
}

/** A failure worth one more try: the server was busy (5xx) or the connection dropped (fetch throws a TypeError). */
const transient = (err: unknown): boolean => err instanceof TypeError || (err instanceof FlowApiError && err.status >= 500);

export async function getWithRetry<T>(url: string, signal?: AbortSignal, pauseMs = RETRY_PAUSE_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestJson<T>(url, { signal });
    } catch (raw) {
      const err = asFlowError(raw);
      if (signal?.aborted || attempt >= 1 || !transient(err)) throw err;
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
}

export function entryPointsUrl(base: string, opts: { includeTests?: boolean; path?: string } = {}): string {
  const q = new URLSearchParams({ max: String(FLOW_LIMITS.entryPoints.cap) });
  if (opts.includeTests) q.set('include_tests', '1');
  if (opts.path) q.set('path', opts.path);
  return `${base}/flow/entry-points?${q}`;
}

export const fetchEntryPoints = (base: string, opts: { includeTests?: boolean; path?: string } = {}, signal?: AbortSignal) =>
  getWithRetry<FlowEntryPointsResponse>(entryPointsUrl(base, opts), signal);

/** `entity` is what the trace route resolves: an entry label, an entity id, a qualified name or a file path. */
export function traceUrl(base: string, entity: string, spec: Pick<FlowSpec, 'depth' | 'direction' | 'follow' | 'maxNodes' | 'includeTests'>): string {
  const q = new URLSearchParams({ entity, depth: String(spec.depth), direction: spec.direction });
  if (spec.follow?.length) q.set('follow', spec.follow.join(','));
  if (spec.maxNodes !== undefined) q.set('max_nodes', String(spec.maxNodes));
  if (spec.includeTests) q.set('include_tests', '1');
  return `${base}/flow/trace?${q}`;
}

export const fetchTrace = (base: string, entity: string, spec: FlowSpec, signal?: AbortSignal) => getWithRetry<FlowTrace>(traceUrl(base, entity, spec), signal);

/** The entry point a link names: the entity (and inline-handler span) it was made from. */
export function findEntry(entries: EntryPoint[], spec: Pick<FlowSpec, 'id' | 'span'>): EntryPoint | undefined {
  const same = entries.filter((e) => e.entity_id === spec.id);
  if (spec.span) return same.find((e) => e.span && e.span.line_start === spec.span?.from && e.span.line_end === spec.span?.to);
  return same.find((e) => !e.span) ?? undefined;
}
