/**
 * Flow routes (Map v2, M6a) — see `contracts/flow.ts` for the shapes.
 *
 *   GET /api/projects/:id/canvas/flow/entry-points[?kind=a,b&path=src/x&include_tests=1&max=N]
 *   GET /api/projects/:id/canvas/flow/trace?entity=…[&depth=N&direction=out|in&max_nodes=N&follow=call,create&include_tests=1]
 *
 * `entity` is an entry-point label ('GET /api/users'), an entity id, a
 * qualified name, a file path or a unique name. Errors are `FlowErrorBody`
 * (400 bad_request, 404 not_found, 409 ambiguous with `candidates`).
 * Same trust model as the other canvas routes: bearer token or explorer
 * session cookie (GET is allowed for cookies by `browser-auth.ts`). The
 * per-project context (graph + detected entry points) is cached until the
 * graph revision or the index time changes. Mounted before the generic
 * canvas router, which would answer 404.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import {
  ENTRY_POINT_KINDS, FLOW_DIRECTIONS, FLOW_ERROR_STATUS, FLOW_FOLLOW_TYPES, FLOW_LIMITS, FLOW_ROUTES,
  type EntryPointKind, type EntryPointsInput, type FlowEntryPointsResponse, type FlowErrorBody, type FlowFollowType, type FlowTrace, type FlowTraceInput,
} from '../contracts/flow.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { buildFlowContext, type FlowContext } from '../flow/context.js';
import { queryEntryPoints, queryTrace } from '../flow/queries.js';
import { readManifest } from '../projects/manifest-sync.js';
import { projectParam, route } from './routes-projects.js';

class BadQuery extends Error {}

const one = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined);
const flag = (v: unknown): boolean | undefined => (one(v) === undefined ? undefined : ['1', 'true', 'yes'].includes(one(v) as string));

function int(req: Request, name: string, min: number, max: number): number | undefined {
  const raw = one(req.query[name]);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new BadQuery(`"${name}" must be an integer between ${min} and ${max}`);
  return n;
}

function list<T extends string>(req: Request, name: string, allowed: readonly T[]): T[] | undefined {
  const raw = one(req.query[name]);
  if (raw === undefined) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = items.find((i) => !(allowed as readonly string[]).includes(i));
  if (bad) throw new BadQuery(`"${name}" has unknown value '${bad}' (one of ${allowed.join(', ')})`);
  return items as T[];
}

export function parseTraceQuery(req: Request): FlowTraceInput {
  const entity = one(req.query.entity)?.trim();
  if (!entity) throw new BadQuery('"entity" is required');
  const direction = one(req.query.direction);
  if (direction !== undefined && !(FLOW_DIRECTIONS as readonly string[]).includes(direction)) throw new BadQuery(`"direction" must be one of ${FLOW_DIRECTIONS.join(', ')}`);
  return {
    entity,
    depth: int(req, 'depth', 1, FLOW_LIMITS.depth.cap),
    direction: direction as FlowTraceInput['direction'],
    max_nodes: int(req, 'max_nodes', 1, FLOW_LIMITS.maxNodes.cap),
    follow: list<FlowFollowType>(req, 'follow', FLOW_FOLLOW_TYPES),
    include_tests: flag(req.query.include_tests),
  };
}

export function parseEntryPointsQuery(req: Request): EntryPointsInput {
  return {
    kind: list<EntryPointKind>(req, 'kind', ENTRY_POINT_KINDS),
    path: one(req.query.path),
    include_tests: flag(req.query.include_tests),
    max_results: int(req, 'max', 1, FLOW_LIMITS.entryPoints.cap),
  };
}

function sendError(res: Response, body: FlowErrorBody): void {
  res.status(FLOW_ERROR_STATUS[body.error.code]).json(body);
}

const flowRoute = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (!(err instanceof BadQuery)) throw err;
      sendError(res, { ok: false, error: { code: 'bad_request', message: err.message } });
    }
  });

interface CacheEntry { key: string; ctx: Promise<FlowContext> }

export function mountFlowRoutes(app: Express, deps: ServiceDeps): void {
  const cache = new Map<string, CacheEntry>();

  const contextFor = (p: ProjectWithStatus): Promise<FlowContext> => {
    const key = [p.root, deps.pool.revision(p.id), readManifest(p.root)?.finished_at ?? '-'].join('|');
    const hit = cache.get(p.id);
    if (hit && hit.key === key) return hit.ctx;
    const ctx = deps.pool.use(p, false, (store) => buildFlowContext(store, p.root, { log: deps.log }), deps.options.explorerReleaseDelayMs);
    cache.set(p.id, { key, ctx });
    ctx.catch(() => cache.delete(p.id));
    return ctx;
  };

  app.get(FLOW_ROUTES.entryPoints, flowRoute(async (req, res) => {
    const input = parseEntryPointsQuery(req);
    const p = await projectParam(deps, req, true);
    const { result, total } = queryEntryPoints(await contextFor(p), input);
    const body: FlowEntryPointsResponse = { ...result, total, truncated: result.entry_points.length < total };
    res.json(body);
  }));

  app.get(FLOW_ROUTES.trace, flowRoute(async (req, res) => {
    const input = parseTraceQuery(req);
    const p = await projectParam(deps, req, true);
    const out = queryTrace(await contextFor(p), input);
    if (!out.ok) return sendError(res, out.error);
    res.json(out.trace satisfies FlowTrace);
  }));
}
