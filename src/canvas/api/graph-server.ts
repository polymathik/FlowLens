/**
 * Graph API server for the canvas (Express, routes under /flowlens-api).
 * Request/response shapes: `src/contracts/canvas/api.ts`.
 */
import express, { type Response } from 'express';
import cors from 'cors';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { validateArchitecture } from '../../analysis/architecture-validator.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { computeDiff } from '../../analysis/diff-computer.js';
import type {
  ArchitecturePreviewResponse,
  ArchitectureSaveResponse,
  ConfigValidationError,
} from '../../contracts/canvas/index.js';
import { parseArchitectureConfig } from './architecture-schema.js';
import { computeHotspotList, computeSummary, loadSavedArchitecture } from './canvas-queries.js';

/**
 * Handle returned by startGraphServer. `broadcast` pushes a named event to
 * every connected SSE client — used by watch mode so the canvas hears
 * about graph updates without polling.
 */
export interface GraphServer {
  close: () => void;
  broadcast: (type: string, payload: unknown) => void;
  /** Port actually bound (useful when 0 was requested). */
  port: number;
}

type Handler = (req: express.Request, res: Response) => Promise<unknown>;

/** Wrap an async route so failures become JSON 500s. */
const route = (fn: Handler) => (req: express.Request, res: Response) => {
  fn(req, res).catch((err) => {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  });
};

export async function startGraphServer(flowlensDir: string, port = 3001): Promise<GraphServer> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const graphStore = new LevelGraphStore();
  await graphStore.open(join(flowlensDir, 'graph'));
  const archPath = join(flowlensDir, 'architecture.json');
  const sseClients = new Set<Response>();

  app.get('/flowlens-api/entities', route(async (_req, res) => res.json(await graphStore.getAllNodes())));
  app.get('/flowlens-api/relations', route(async (_req, res) => res.json(await graphStore.getAllEdges())));
  app.get('/flowlens-api/summary', route(async (_req, res) => res.json(await computeSummary(graphStore, flowlensDir))));

  // GET /flowlens-api/hotspots?limit=50 — from stored entity metrics
  app.get(
    '/flowlens-api/hotspots',
    route(async (req, res) => {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 1000);
      res.json(await computeHotspotList(graphStore, limit));
    }),
  );

  // GET /flowlens-api/architecture — saved rules ({ layers: [] } when none)
  app.get(
    '/flowlens-api/architecture',
    route(async (_req, res) => {
      if (!existsSync(archPath)) return res.json({ layers: [] });
      res.json(JSON.parse(await readFile(archPath, 'utf-8')));
    }),
  );

  const invalid = (res: Response, issues: ConfigValidationError['issues']) =>
    res.status(400).json({ error: 'invalid_architecture_config', issues } satisfies ConfigValidationError);

  // POST /flowlens-api/architecture — validate (400 on error) then save
  app.post(
    '/flowlens-api/architecture',
    route(async (req, res) => {
      const parsed = parseArchitectureConfig(req.body);
      if (!parsed.ok) return invalid(res, parsed.issues);
      await writeFile(archPath, JSON.stringify(parsed.config, null, 2) + '\n');
      const violations = await validateArchitecture(graphStore, parsed.config);
      res.json({ ok: true, violation_count: violations.length } satisfies ArchitectureSaveResponse);
    }),
  );

  // POST /flowlens-api/architecture/preview — validate + compute violations, never save
  app.post(
    '/flowlens-api/architecture/preview',
    route(async (req, res) => {
      const parsed = parseArchitectureConfig(req.body);
      if (!parsed.ok) return invalid(res, parsed.issues);
      const violations = await validateArchitecture(graphStore, parsed.config);
      res.json({ violations, count: violations.length } satisfies ArchitecturePreviewResponse);
    }),
  );

  app.get(
    '/flowlens-api/annotations',
    route(async (_req, res) => {
      const annPath = join(flowlensDir, 'annotations.json');
      if (!existsSync(annPath)) return res.json({ annotations: [] });
      res.json(JSON.parse(await readFile(annPath, 'utf-8')));
    }),
  );

  app.get('/flowlens-api/cycles', route(async (_req, res) => res.json(await detectCycles(graphStore, { granularity: 'file' }))));

  app.get(
    '/flowlens-api/violations',
    route(async (_req, res) => {
      const config = await loadSavedArchitecture(flowlensDir);
      res.json(config ? await validateArchitecture(graphStore, config) : []);
    }),
  );

  // GET /flowlens-api/events — SSE stream for push updates (watch mode)
  app.get('/flowlens-api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: hello\ndata: {}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // GET /flowlens-api/diff?sha=<sha> — interface diff against a snapshot
  app.get(
    '/flowlens-api/diff',
    route(async (req, res) => {
      const sha = req.query.sha as string;
      if (!sha) return res.status(400).json({ error: 'sha required' });
      const snapshot = await new SnapshotManager(join(flowlensDir, 'snapshots')).loadSnapshot(sha);
      if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
      res.json(await computeDiff(graphStore, snapshot));
    }),
  );

  function broadcast(type: string, payload: unknown): void {
    const line = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(line);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        close: () => {
          for (const client of sseClients) client.end();
          sseClients.clear();
          server.close();
          graphStore.close();
        },
        broadcast,
      });
    });
    server.on('error', async (err) => {
      await graphStore.close();
      reject(err);
    });
  });
}
