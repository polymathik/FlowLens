import express from 'express';
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

export async function startGraphServer(
  flowlensDir: string,
  port = 3001,
): Promise<{ close: () => void }> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const graphStore = new LevelGraphStore();
  await graphStore.open(join(flowlensDir, 'graph'));

  // GET /api/entities — all entities
  app.get('/api/entities', async (_req, res) => {
    try {
      const entities = await graphStore.getAllNodes();
      res.json(entities);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/relations — all relations
  app.get('/api/relations', async (_req, res) => {
    try {
      const relations = await graphStore.getAllEdges();
      res.json(relations);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/architecture — architecture.json
  app.get('/api/architecture', async (_req, res) => {
    const archPath = join(flowlensDir, 'architecture.json');
    if (!existsSync(archPath)) return res.json({ layers: [] });
    const content = await readFile(archPath, 'utf-8');
    res.json(JSON.parse(content));
  });

  // POST /api/architecture — save architecture.json
  app.post('/api/architecture', async (req, res) => {
    const archPath = join(flowlensDir, 'architecture.json');
    await writeFile(archPath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  });

  // GET /api/annotations — annotations.json
  app.get('/api/annotations', async (_req, res) => {
    const annPath = join(flowlensDir, 'annotations.json');
    if (!existsSync(annPath)) return res.json({ annotations: [] });
    const content = await readFile(annPath, 'utf-8');
    res.json(JSON.parse(content));
  });

  // GET /api/cycles — cycle detection
  app.get('/api/cycles', async (_req, res) => {
    try {
      const cycles = await detectCycles(graphStore, { granularity: 'file' });
      res.json(cycles);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/violations — architecture violations
  app.get('/api/violations', async (_req, res) => {
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

  // GET /api/diff?sha=<sha> — interface diff against a snapshot
  app.get('/api/diff', async (req, res) => {
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

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({
        close: () => {
          server.close();
          graphStore.close();
        },
      });
    });
  });
}
