/**
 * `POST /api/projects/:id/reindex` (ReindexRequest → ReindexResponse):
 * run the incremental indexer inside the daemon, against the pooled store,
 * in the project's per-project write queue. Index runs from agent hooks,
 * `flowlens index`, `flowlens init` and the daemon watcher therefore run
 * one after another — each sees the symbols snapshot and file index the
 * previous one wrote (Phase 12 review H1).
 */
import { join } from 'node:path';
import type { Express } from 'express';
import type { IndexResult } from '../contracts/indexer.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import { SERVICE_ROUTES, type ReindexRequest, type ReindexResponse } from '../contracts/service.js';
import { runIndex } from '../indexer/indexer.js';
import { loadProjectConfig } from '../projects/config.js';
import { projectFlowlensDir } from '../projects/paths.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { ServiceError } from './errors.js';
import { projectParam, route } from './routes-projects.js';

function validate(body: unknown): ReindexRequest {
  const b = (body ?? {}) as Partial<ReindexRequest>;
  if (b.paths !== undefined && !(Array.isArray(b.paths) && b.paths.every((p) => typeof p === 'string'))) {
    throw new ServiceError('bad_request', '"paths" must be an array of strings');
  }
  if (b.full !== undefined && typeof b.full !== 'boolean') throw new ServiceError('bad_request', '"full" must be a boolean');
  return { paths: b.paths, full: b.full };
}

/** One serialized indexer run for `project` inside the daemon. */
export async function reindexInDaemon(deps: ServiceDeps, project: ProjectWithStatus, req: ReindexRequest): Promise<IndexResult> {
  const flowlensDir = projectFlowlensDir(project.root);
  const result = await deps.pool.use(project, true, (graphStore) => runIndex({
    rootDir: project.root,
    graphStore,
    config: loadProjectConfig(project.root),
    fileIndexPath: join(flowlensDir, 'file_index.json'),
    flowlensDir,
    incremental: req.full !== true,
    paths: req.full ? undefined : req.paths,
  }));
  deps.hub.broadcast(project.id, {
    type: 'graph-changed', project_id: project.id, source: 'rpc',
    files_reparsed: result.filesIndexed - result.filesReresolved, files_deleted: result.filesDeleted,
    paths: (req.paths ?? []).slice(0, 50),
    errors: result.errors.slice(0, 50).map((e) => ({ path: e.file, message: e.message })),
    duration_ms: result.duration, at: new Date().toISOString(),
  });
  deps.log(`[reindex] ${project.id}: ${result.filesIndexed} parsed / ${result.filesDeleted} deleted in ${result.duration}ms`);
  return result;
}

export function mountReindexRoute(app: Express, deps: ServiceDeps): void {
  app.post(SERVICE_ROUTES.reindex, route(async (req, res) => {
    const project = await projectParam(deps, req, true);
    const result = await reindexInDaemon(deps, project, validate(req.body));
    const out: ReindexResponse = { ok: true, result };
    res.json(out);
  }));
}
