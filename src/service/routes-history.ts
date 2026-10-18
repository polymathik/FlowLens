/**
 * History routes (Map v2, M5a) — see `HISTORY_ROUTES` in contracts/history.ts
 * for the full REST description.
 *
 *   GET    /api/projects/:id/canvas/history[?max=N&first_parent=1]   commit history (built/updated on demand)
 *   DELETE /api/projects/:id/canvas/history                          cancel the job, drop both caches
 *   GET    /api/projects/:id/canvas/history/topology                 stored sampled topology (404 not_built)
 *   POST   /api/projects/:id/canvas/history/topology/build           start the job → 202 (409 while one runs)
 *   GET    /api/projects/:id/canvas/history/topology/status          job progress
 *   DELETE /api/projects/:id/canvas/history/topology/build           cancel the job
 *
 * Same trust model as the other canvas routes: bearer token or explorer
 * session cookie; state-changing browser requests need a same-origin
 * `Origin` (see browser-auth.ts). The build body is validated (zod) and
 * capped at 4 KB by a parser mounted in app.ts before the daemon-wide one.
 * Mounted before the generic canvas router, which would answer 404.
 */
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import {
  HISTORY_BUILD_BODY_MAX_BYTES, HISTORY_ERROR_STATUS, HISTORY_MAX_LIMIT, HISTORY_ROUTES, HistoryError,
  type HistoryBuildOptions, type HistoryClearResult, type HistoryErrorBody, type TopologyBuildStarted,
} from '../contracts/history.js';
import { parseTopologyBuildBody } from '../contracts/history-schema.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { HistoryService } from '../history/service.js';
import { projectParam, route } from './routes-projects.js';

/** JSON parser limited to the build body cap (mount before any larger parser). */
export const historyBodyParser = (): RequestHandler => express.json({ limit: HISTORY_BUILD_BODY_MAX_BYTES });

function sendHistoryError(res: Response, err: HistoryError): void {
  const body: HistoryErrorBody = { ok: false, error: { code: err.code, message: err.message }, ...(err.jobId ? { job_id: err.jobId } : {}) };
  res.status(HISTORY_ERROR_STATUS[err.code]).json(body);
}

/** Like `route`, but typed history failures become `HistoryErrorBody` responses. */
const historyRoute = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HistoryError) sendHistoryError(res, err);
      else throw err;
    }
  });

function summaryOptions(req: Request): HistoryBuildOptions {
  const o: HistoryBuildOptions = {};
  const { max, first_parent: fp } = req.query;
  if (max !== undefined) {
    const n = Number(max);
    if (typeof max !== 'string' || !Number.isInteger(n) || n < 1 || n > HISTORY_MAX_LIMIT) {
      throw new HistoryError('bad_request', `"max" must be an integer between 1 and ${HISTORY_MAX_LIMIT}`);
    }
    o.max = n;
  }
  if (fp !== undefined) o.firstParent = fp === '1' || fp === 'true';
  return o;
}

export function mountHistoryRoutes(app: Express, deps: ServiceDeps, service: HistoryService = new HistoryService({ log: deps.log })): HistoryService {
  app.get(HISTORY_ROUTES.history, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json(await service.summary(p, summaryOptions(req)));
  }));

  app.delete(HISTORY_ROUTES.history, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const out: HistoryClearResult = { ok: true, removed: await service.clear(p) };
    res.json(out);
  }));

  app.get(HISTORY_ROUTES.topology, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json(await service.topology(p));
  }));

  app.post(HISTORY_ROUTES.topologyBuild, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const parsed = parseTopologyBuildBody(req.body);
    if (!parsed.ok) throw new HistoryError('bad_request', parsed.message);
    const status = await service.startTopology(p, parsed.value);
    const out: TopologyBuildStarted = { ok: true, job_id: status.job_id as string, status };
    res.status(202).json(out);
  }));

  app.delete(HISTORY_ROUTES.topologyBuild, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json(await service.cancel(p));
  }));

  app.get(HISTORY_ROUTES.topologyStatus, historyRoute(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json(service.status(p));
  }));

  return service;
}
