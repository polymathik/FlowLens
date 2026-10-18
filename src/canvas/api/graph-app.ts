/**
 * createGraphApp — the canvas graph API for ONE project as an Express
 * router, so it can be mounted by the daemon (`/api/projects/:id/canvas`)
 * or by the standalone `startGraphServer` (`/flowlens-api`).
 *
 * Request/response shapes: `src/contracts/canvas/api.ts`.
 *
 * `graph` is either an open GraphStore or a provider that lends a store for
 * the duration of one request (the daemon's pool: the DB stays open while a
 * handler runs and is released afterwards). The canvas API only reads the
 * graph; the rules editor writes `.flowlens/architecture.json`.
 */
import express, { type Request, type Response, type Router } from 'express';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { GraphStore } from '../../contracts/graph.js';
import type {
  ArchitecturePreviewResponse,
  ArchitectureSaveResponse,
  ConfigValidationError,
} from '../../contracts/canvas/index.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { validateArchitecture } from '../../analysis/architecture-validator.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { computeDiff } from '../../analysis/diff-computer.js';
import { ARCHITECTURE_FILE, loadArchConfigOrNull } from '../../analysis/arch-config.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArchitectureConfig } from './architecture-schema.js';
import { computeHotspotList, computeSummary } from './canvas-queries.js';

/** Lends an open store for the duration of `fn` (read-only use). */
export interface GraphProvider {
  withGraph<T>(fn: (graph: GraphStore) => Promise<T>): Promise<T>;
}

/** Where `/events` subscribers go; defaults to a local SSE hub. */
export interface GraphEvents {
  subscribe(req: Request, res: Response): void;
}

export interface GraphAppOptions {
  graph: GraphStore | GraphProvider;
  rootDir: string;
  flowlensDir: string;
  events?: GraphEvents;
}

export interface GraphApp {
  router: Router;
  /** Push a named SSE event to local subscribers (only when `events` was not given). */
  broadcast: (type: string, payload: unknown) => void;
  /** End every local SSE stream. */
  closeEvents: () => void;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wrap an async route so failures become JSON 500s. */
const route = (fn: Handler) => (req: Request, res: Response) => {
  fn(req, res).catch((err: unknown) => {
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
};

function isProvider(g: GraphStore | GraphProvider): g is GraphProvider {
  return typeof (g as GraphProvider).withGraph === 'function';
}

/** Local SSE hub for the standalone server. */
function localEvents() {
  const clients = new Set<Response>();
  return {
    subscribe(req: Request, res: Response) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write('event: hello\ndata: {}\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(type: string, payload: unknown) {
      const line = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const c of clients) {
        try {
          c.write(line);
        } catch {
          clients.delete(c);
        }
      }
    },
    close() {
      for (const c of clients) c.end();
      clients.clear();
    },
  };
}

export function createGraphApp(opts: GraphAppOptions): GraphApp {
  const { flowlensDir } = opts;
  const g = opts.graph;
  const withGraph = <T>(fn: (s: GraphStore) => Promise<T>): Promise<T> => (isProvider(g) ? g.withGraph(fn) : fn(g));
  const archPath = join(flowlensDir, ARCHITECTURE_FILE);
  const local = opts.events ? null : localEvents();
  const router = express.Router({ mergeParams: true });
  router.use(express.json({ limit: '2mb' }));

  router.get('/entities', route(async (_req, res) => res.json(await withGraph((s) => s.getAllNodes()))));
  router.get('/relations', route(async (_req, res) => res.json(await withGraph((s) => s.getAllEdges()))));
  router.get('/summary', route(async (_req, res) => res.json(await withGraph((s) => computeSummary(s, flowlensDir)))));

  router.get('/hotspots', route(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 1000);
    res.json(await withGraph((s) => computeHotspotList(s, limit)));
  }));

  router.get('/architecture', route(async (_req, res) => {
    if (!existsSync(archPath)) return res.json({ layers: [] });
    res.json(JSON.parse(await readFile(archPath, 'utf-8')));
  }));

  const invalid = (res: Response, issues: ConfigValidationError['issues']) =>
    res.status(400).json({ error: 'invalid_architecture_config', issues } satisfies ConfigValidationError);

  router.post('/architecture', route(async (req, res) => {
    const parsed = parseArchitectureConfig(req.body);
    if (!parsed.ok) return invalid(res, parsed.issues);
    await writeFile(archPath, JSON.stringify(parsed.config, null, 2) + '\n');
    const violations = await withGraph((s) => validateArchitecture(s, parsed.config));
    res.json({ ok: true, violation_count: violations.length } satisfies ArchitectureSaveResponse);
  }));

  router.post('/architecture/preview', route(async (req, res) => {
    const parsed = parseArchitectureConfig(req.body);
    if (!parsed.ok) return invalid(res, parsed.issues);
    const violations = await withGraph((s) => validateArchitecture(s, parsed.config));
    res.json({ violations, count: violations.length } satisfies ArchitecturePreviewResponse);
  }));

  router.get('/annotations', route(async (_req, res) => {
    const annPath = join(flowlensDir, 'annotations.json');
    if (!existsSync(annPath)) return res.json({ annotations: [] });
    res.json(JSON.parse(await readFile(annPath, 'utf-8')));
  }));

  router.get('/cycles', route(async (_req, res) => res.json(await withGraph((s) => detectCycles(s, { granularity: 'file' })))));

  router.get('/violations', route(async (_req, res) => {
    const config = await loadArchConfigOrNull(flowlensDir);
    res.json(config ? await withGraph((s) => validateArchitecture(s, config)) : []);
  }));

  router.get('/diff', route(async (req, res) => {
    const sha = typeof req.query.sha === 'string' ? req.query.sha : '';
    if (!sha) return res.status(400).json({ error: 'sha required' });
    const snapshot = await new SnapshotManager(join(flowlensDir, 'snapshots')).loadSnapshot(sha);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(await withGraph((s) => computeDiff(s, snapshot)));
  }));

  router.get('/events', (req, res) => (opts.events ?? local!).subscribe(req, res));

  return {
    router,
    broadcast: (type, payload) => local?.broadcast(type, payload),
    closeEvents: () => local?.close(),
  };
}
