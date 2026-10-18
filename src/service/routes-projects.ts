/**
 * Project routes: list/detail (status + manifest + graph state), resolve
 * (canonicalise + register a root), leases, close (evict) and SSE events.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { ProjectWithStatus } from '../contracts/projects.js';
import type { LeaseRequest, ProjectDetail, ResolveProjectRequest } from '../contracts/service.js';
import { readManifest, syncLastIndexed } from '../projects/manifest-sync.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { ServiceError } from './errors.js';

type Handler = (req: Request, res: Response) => Promise<void>;

/** Wrap an async handler so rejections reach the Express error handler. */
export function route(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

/** Load `:id` from the registry; `requireOk` rejects missing projects. */
export async function projectParam(
  deps: ServiceDeps, req: Request, requireOk: boolean,
): Promise<ProjectWithStatus> {
  const id = String(req.params.id);
  const project = requireOk ? await deps.projects.get(id) : await deps.registry.get(id);
  if (!project) throw new ServiceError('not_found', `Unknown project: ${id}`);
  if (requireOk && project.status !== 'ok') {
    throw new ServiceError('project_missing', `Project ${project.name} is missing (${project.root})`);
  }
  return project;
}

async function detail(deps: ServiceDeps, p: ProjectWithStatus): Promise<ProjectDetail> {
  const last_indexed = p.status === 'ok' ? await syncLastIndexed(deps.registry, p) : p.last_indexed;
  return {
    ...p,
    last_indexed,
    manifest: p.status === 'ok' ? readManifest(p.root) : null,
    graph: deps.pool.state(p.id),
  };
}

export function mountProjectRoutes(app: Express, deps: ServiceDeps): void {
  app.get('/api/projects', route(async (_req, res) => {
    const all = await deps.registry.list();
    res.json(await Promise.all(all.map((p) => detail(deps, p))));
  }));

  app.post('/api/projects/resolve', route(async (req, res) => {
    const body = req.body as Partial<ResolveProjectRequest> | undefined;
    if (!body || typeof body.root !== 'string') throw new ServiceError('bad_request', '"root" is required');
    let project = await deps.registry.findByRoot(body.root);
    if (!project && body.register !== false) {
      const rec = await deps.registry.register(body.root);
      project = await deps.registry.get(rec.id);
    }
    if (!project) throw new ServiceError('not_found', `Project not registered: ${body.root}`);
    deps.projects.invalidate(project.id);
    res.json(project);
  }));

  app.get('/api/projects/:id', route(async (req, res) => {
    res.json(await detail(deps, await projectParam(deps, req, false)));
  }));

  app.post('/api/projects/:id/leases', route(async (req, res) => {
    const p = await projectParam(deps, req, true);
    const body = (req.body ?? {}) as LeaseRequest;
    const lease = deps.pool.acquireLease(p, {
      watch: body.watch, debounceMs: body.debounce_ms, client: body.client,
    });
    // A watch lease answers once the watcher is ready, so edits made right after are not missed.
    if (body.watch) await deps.watchers.whenReady(p.id);
    res.json({ ok: true, lease_id: lease.id, ttl_ms: deps.options.leaseTtlMs, project_id: p.id });
  }));

  app.put('/api/projects/:id/leases/:lease', route(async (req, res) => {
    if (!deps.pool.renewLease(String(req.params.id), String(req.params.lease))) {
      throw new ServiceError('not_found', 'Unknown or expired lease');
    }
    res.json({ ok: true });
  }));

  app.delete('/api/projects/:id/leases/:lease', route(async (req, res) => {
    const id = String(req.params.id);
    const released = deps.pool.releaseLease(id, String(req.params.lease));
    const p = await deps.registry.get(id);
    if (released && p && p.status === 'ok') await syncLastIndexed(deps.registry, p);
    res.json({ ok: true, released });
  }));

  app.post('/api/projects/:id/close', route(async (req, res) => {
    const id = String(req.params.id);
    deps.projects.invalidate(id);
    await deps.watchers.stop(id);
    await deps.pool.close(id, true);
    res.json({ ok: true });
  }));

  app.get('/api/projects/:id/events', route(async (req, res) => {
    const p = await projectParam(deps, req, false);
    deps.hub.subscribe(p.id, res);
  }));
}
