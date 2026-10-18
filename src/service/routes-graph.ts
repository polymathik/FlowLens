/**
 * Graph RPC: `POST /api/projects/:id/rpc { method, args }` runs one
 * GraphStore method against the project's pooled store. Writes go through
 * the per-project write queue and trigger a debounced `graph-changed`
 * event. Array results of the bulk readers are streamed in chunks so a
 * 100K-entity `getAllNodes` never builds one giant JSON string.
 *
 * The same handler is served twice: as an Express route (for embedders)
 * and as a raw `node:http` fast path the daemon checks before Express,
 * which cuts per-call overhead several-fold on the hot path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import type { GraphStore } from '../contracts/graph.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import {
  GRAPH_READ_METHODS, GRAPH_WRITE_METHODS, type GraphRpcMethod, type GraphRpcRequest,
} from '../contracts/service.js';
import type { ServiceDeps } from '../contracts/service-deps.js';
import { authenticate } from './auth.js';
import { errorBody, ServiceError, toServiceError } from './errors.js';
import { projectParam, route } from './routes-projects.js';

const READ = new Set<string>(GRAPH_READ_METHODS);
const WRITE = new Set<string>(GRAPH_WRITE_METHODS);
const CHUNK = 1000;
const MAX_BODY = 512 * 1024 * 1024;
const RPC_PATH = /^\/api\/projects\/([^/?]+)\/rpc(?:\?.*)?$/;

type AnyMethod = (...args: unknown[]) => Promise<unknown>;

function validate(body: unknown): GraphRpcRequest {
  const b = body as Partial<GraphRpcRequest> | undefined;
  if (!b || typeof b.method !== 'string' || !(READ.has(b.method) || WRITE.has(b.method))) {
    throw new ServiceError('bad_request', `Unknown graph method: ${String(b?.method)}`);
  }
  if (b.args !== undefined && !Array.isArray(b.args)) {
    throw new ServiceError('bad_request', '"args" must be an array');
  }
  return { method: b.method as GraphRpcMethod, args: (b.args ?? []) as GraphRpcRequest['args'] };
}

export async function executeRpc(deps: ServiceDeps, project: ProjectWithStatus, body: unknown): Promise<unknown> {
  const { method, args } = validate(body);
  const write = WRITE.has(method);
  const result = await deps.pool.use(project, write, (store: GraphStore) =>
    (store[method] as unknown as AnyMethod).apply(store, args as unknown[]),
  );
  if (write) {
    deps.hub.broadcastDebounced(project.id, deps.options.rpcEventDebounceMs, () => ({
      type: 'graph-changed', project_id: project.id, source: 'rpc', files_reparsed: 0,
      files_deleted: 0, paths: [], errors: [], duration_ms: 0, at: new Date().toISOString(),
    }));
  }
  return result ?? null;
}

/** Write `{ok:true,result}`; large arrays are streamed in chunks with backpressure. */
export async function sendRpcResult(res: ServerResponse, result: unknown): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!Array.isArray(result) || result.length <= CHUNK) {
    res.end(JSON.stringify({ ok: true, result }));
    return;
  }
  res.write('{"ok":true,"result":[');
  for (let i = 0; i < result.length; i += CHUNK) {
    const part = result.slice(i, i + CHUNK).map((x) => JSON.stringify(x)).join(',');
    if (!res.write(i === 0 ? part : `,${part}`)) await new Promise<void>((r) => res.once('drain', () => r()));
  }
  res.end(']}');
}

function sendError(res: ServerResponse, err: unknown): void {
  const se = toServiceError(err);
  res.statusCode = se.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(errorBody(se.code, se.message)));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy(new ServiceError('bad_request', 'Request body too large'));
      else chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(size === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ServiceError('bad_request', 'Body is not valid JSON'));
      }
    });
  });
}

/** Raw-http handler for the RPC route; returns false when the request is not an RPC call. */
export function createRpcFastPath(deps: ServiceDeps) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const m = req.method === 'POST' ? RPC_PATH.exec(req.url ?? '') : null;
    if (!m) return false;
    void (async () => {
      try {
        const denied = authenticate(deps.token, req.headers, req.url ?? '', req.method);
        if (denied) throw denied;
        deps.onActivity?.();
        const id = decodeURIComponent(m[1]);
        const project = await deps.projects.get(id);
        if (!project) throw new ServiceError('not_found', `Unknown project: ${id}`);
        if (project.status !== 'ok') throw new ServiceError('project_missing', `Project ${project.name} is missing (${project.root})`);
        await sendRpcResult(res, await executeRpc(deps, project, await readBody(req)));
      } catch (err) {
        sendError(res, err);
      }
    })();
    return true;
  };
}

export function mountGraphRoutes(app: Express, deps: ServiceDeps): void {
  app.post('/api/projects/:id/rpc', route(async (req, res) => {
    const project = await projectParam(deps, req, true);
    await sendRpcResult(res, await executeRpc(deps, project, req.body));
  }));
}
