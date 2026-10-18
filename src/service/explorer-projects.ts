/**
 * Per-project explorer routes on the daemon:
 *
 *   DELETE /api/projects/:id[?force=1]       remove from registry (+ stop watcher, close DB);
 *                                            409 project_in_use while clients hold leases, unless force
 *   GET|PUT /api/projects/:id/canvas/zones   zone overrides (.flowlens/zones.json), see routes-zones.ts
 *   *      /api/projects/:id/canvas/*        canvas graph API (createGraphApp) on the pooled graph
 *   GET    /api/projects/:id/health          HealthReport
 *   GET    /api/projects/:id/health/summary  ExplorerHealthSummary
 *   GET    /api/projects/:id/health/report?format=html|md   download
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { Router } from 'express';
import { createGraphApp } from '../canvas/api/graph-app.js';
import {
  EXPLORER_ROUTES, type ExplorerHealthSummary, type HealthReportFormat,
} from '../contracts/canvas/explorer.js';
import type { HealthReport } from '../contracts/health.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import { buildHealthReport, loadHealthInput, renderHealth, summarizeHealth } from '../health/index.js';
import { projectFlowlensDir } from '../projects/paths.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { ServiceError } from './errors.js';
import { HealthCache, healthFingerprint } from './health-cache.js';
import { projectParam, route } from './routes-projects.js';
import { mountZonesRoutes } from './routes-zones.js';

export interface ExplorerProjectState {
  health: HealthCache;
  routers: Map<string, { root: string; router: Router }>;
}

export function createExplorerProjectState(): ExplorerProjectState {
  return { health: new HealthCache(), routers: new Map() };
}

export async function projectHealth(
  deps: ServiceDeps, state: ExplorerProjectState, p: ProjectWithStatus,
): Promise<{ report: HealthReport; cached: boolean; revision: number }> {
  const revision = deps.pool.revision(p.id);
  const result = await state.health.get(p.id, healthFingerprint(p.root, revision), async () => {
    const input = await deps.pool.use(p, false, (graphStore) => loadHealthInput(p.root, { graphStore }), deps.options.explorerReleaseDelayMs);
    return buildHealthReport(input, { canvas_base_url: `http://127.0.0.1:${deps.port}` });
  });
  return { ...result, revision };
}

function canvasRouter(deps: ServiceDeps, state: ExplorerProjectState, p: ProjectWithStatus): Router {
  const hit = state.routers.get(p.id);
  if (hit && hit.root === p.root) return hit.router;
  const { router } = createGraphApp({
    graph: { withGraph: (fn) => deps.pool.use(p, false, fn, deps.options.explorerReleaseDelayMs) },
    rootDir: p.root,
    flowlensDir: projectFlowlensDir(p.root),
    events: { subscribe: (_req, res) => deps.hub.subscribe(p.id, res) },
  });
  state.routers.set(p.id, { root: p.root, router });
  return router;
}

const FORMATS: Record<HealthReportFormat, { type: string; ext: string }> = {
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
  md: { type: 'text/markdown; charset=utf-8', ext: 'md' },
};

export function mountExplorerProjects(app: Express, deps: ServiceDeps, state: ExplorerProjectState): void {
  app.delete(EXPLORER_ROUTES.removeProject, route(async (req, res) => {
    const id = String(req.params.id);
    const existing = await deps.registry.get(id);
    if (!existing) throw new ServiceError('not_found', `Unknown project: ${id}`);
    const leases = deps.pool.state(id).leases;
    if (leases > 0 && req.query.force !== '1') {
      throw new ServiceError('project_in_use', `${existing.name} is in use by ${leases} client(s); remove with ?force=1 (they re-register on their next request).`);
    }
    await deps.watchers.stop(id);
    await deps.pool.close(id, true);
    const removed = await deps.registry.remove(id);
    deps.projects.invalidate(id);
    state.health.delete(id);
    state.routers.delete(id);
    res.json({ ok: true, removed });
  }));

  mountZonesRoutes(app, deps); // before the generic canvas router, which would 404 it

  app.use(EXPLORER_ROUTES.canvas, (req: Request, res: Response, next: NextFunction) => {
    projectParam(deps, req, true)
      .then((p) => canvasRouter(deps, state, p)(req, res, next))
      .catch(next);
  });

  app.get(EXPLORER_ROUTES.health, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    res.json((await projectHealth(deps, state, p)).report);
  }));

  app.get(EXPLORER_ROUTES.healthSummary, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const { report, cached, revision } = await projectHealth(deps, state, p);
    const out: ExplorerHealthSummary = { ...summarizeHealth(report), revision, cached };
    res.json(out);
  }));

  app.get(EXPLORER_ROUTES.healthReport, route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const format: HealthReportFormat = req.query.format === 'md' ? 'md' : 'html';
    const { report } = await projectHealth(deps, state, p);
    const safeName = p.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'project';
    res.set({
      'Content-Type': FORMATS[format].type,
      'Content-Disposition': `attachment; filename="flowlens-health-${safeName}.${FORMATS[format].ext}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(renderHealth(report, format));
  }));
}
