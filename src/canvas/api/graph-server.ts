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
import type { ArchitectureConfig } from '../../contracts/architecture.js';

/**
 * Handle returned by startGraphServer. `broadcast` pushes a named event to
 * every connected SSE client — used by watch mode so the canvas hears
 * about graph updates without polling.
 */
export interface GraphServer {
  close: () => void;
  broadcast: (type: string, payload: unknown) => void;
}

export async function startGraphServer(
  flowlensDir: string,
  port = 3001,
): Promise<GraphServer> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const graphStore = new LevelGraphStore();
  await graphStore.open(join(flowlensDir, 'graph'));

  const sseClients = new Set<Response>();

  // GET /flowlens-api/entities — all entities
  app.get('/flowlens-api/entities', async (_req, res) => {
    try {
      const entities = await graphStore.getAllNodes();
      res.json(entities);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /flowlens-api/relations — all relations
  app.get('/flowlens-api/relations', async (_req, res) => {
    try {
      const relations = await graphStore.getAllEdges();
      res.json(relations);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /flowlens-api/summary — entity/relation counts
  app.get('/flowlens-api/summary', async (_req, res) => {
    try {
      const entities = await graphStore.getAllNodes();
      const relations = await graphStore.getAllEdges();
      const entities_by_kind: Record<string, number> = {};
      for (const e of entities) {
        entities_by_kind[e.kind] = (entities_by_kind[e.kind] ?? 0) + 1;
      }
      const relations_by_type: Record<string, number> = {};
      for (const r of relations) {
        relations_by_type[r.type] = (relations_by_type[r.type] ?? 0) + 1;
      }
      res.json({
        entity_count: entities.length,
        relation_count: relations.length,
        entities_by_kind,
        relations_by_type,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /flowlens-api/architecture — architecture.json
  app.get('/flowlens-api/architecture', async (_req, res) => {
    const archPath = join(flowlensDir, 'architecture.json');
    if (!existsSync(archPath)) return res.json({ layers: [] });
    const content = await readFile(archPath, 'utf-8');
    res.json(JSON.parse(content));
  });

  // POST /flowlens-api/architecture — save architecture.json
  app.post('/flowlens-api/architecture', async (req, res) => {
    const archPath = join(flowlensDir, 'architecture.json');
    await writeFile(archPath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  });

  // GET /flowlens-api/annotations — annotations.json
  app.get('/flowlens-api/annotations', async (_req, res) => {
    const annPath = join(flowlensDir, 'annotations.json');
    if (!existsSync(annPath)) return res.json({ annotations: [] });
    const content = await readFile(annPath, 'utf-8');
    res.json(JSON.parse(content));
  });

  // GET /flowlens-api/cycles — cycle detection
  app.get('/flowlens-api/cycles', async (_req, res) => {
    try {
      const cycles = await detectCycles(graphStore, { granularity: 'file' });
      res.json(cycles);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /flowlens-api/violations — architecture violations
  app.get('/flowlens-api/violations', async (_req, res) => {
    try {
      const archPath = join(flowlensDir, 'architecture.json');
      if (!existsSync(archPath)) return res.json([]);
      const config: ArchitectureConfig = JSON.parse(await readFile(archPath, 'utf-8'));
      const violations = await validateArchitecture(graphStore, config);
      res.json(violations);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /flowlens-api/events — SSE stream for push updates (watch mode)
  app.get('/flowlens-api/events', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    // Emit a hello so the client sees the stream is live.
    res.write(`event: hello\ndata: {}\n\n`);
    sseClients.add(res);
    _req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // GET /flowlens-api/diff?sha=<sha> — interface diff against a snapshot
  app.get('/flowlens-api/diff', async (req, res) => {
    try {
      const sha = req.query.sha as string;
      if (!sha) return res.status(400).json({ error: 'sha required' });
      const snapshotMgr = new SnapshotManager(join(flowlensDir, 'snapshots'));
      const snapshot = await snapshotMgr.loadSnapshot(sha);
      if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
      const diff = await computeDiff(graphStore, snapshot);
      res.json(diff);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

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

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({
        close: () => {
          for (const client of sseClients) client.end();
          sseClients.clear();
          server.close();
          graphStore.close();
        },
        broadcast,
      });
    });
  });
}
