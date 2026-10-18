/**
 * End-to-end over HTTP: index the sample-app fixture, start the canvas
 * graph server and exercise summary, hotspots, cycles and the validated
 * architecture save / preview endpoints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startGraphServer, type GraphServer } from '../../src/canvas/api/graph-server.js';
import type { CanvasHotspotsResponse, CanvasSummary } from '../../src/contracts/canvas/index.js';
import { createIndexedFixture, type IndexedFixture } from './helpers/fixture-project.js';

let fixture: IndexedFixture;
let server: GraphServer;
let base: string;

const get = async <T>(path: string): Promise<T> => (await fetch(`${base}${path}`)).json() as Promise<T>;
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  fixture = await createIndexedFixture();
  server = await startGraphServer(fixture.flowlensDir, 0);
  base = `http://127.0.0.1:${server.port}/flowlens-api`;
}, 60000);

afterAll(async () => {
  server?.close();
  await new Promise((r) => setTimeout(r, 100));
  await fixture?.cleanup();
});

describe('canvas graph server', () => {
  it('summary reports files, symbols, relations, cycles, rule breaks and last indexed', async () => {
    const s = await get<CanvasSummary>('/summary');
    expect(s.file_count).toBe(9);
    expect(s.relations_by_type.import).toBeGreaterThanOrEqual(8);
    expect(s.cycle_count).toBe(1);
    // routes.ts→ui/view.ts import plus the cross-file handleGetUser→renderUser call (Phase 8).
    expect(s.violation_count).toBe(2);
    expect(Date.parse(s.last_indexed!)).not.toBeNaN();
  });

  it('cycles are file-level (view.ts ↔ widgets.ts)', async () => {
    const cycles = await get<Array<{ entities: string[] }>>('/cycles');
    expect(cycles[0].entities).toEqual(['src/ui/view.ts', 'src/ui/widgets.ts']);
  });

  it('hotspots come from stored metrics, hottest first', async () => {
    const r = await get<CanvasHotspotsResponse>('/hotspots?limit=3');
    if (!fixture.hasGit) return expect(r.total).toBe(0);
    expect(r.hotspots.length).toBeGreaterThan(0);
    expect(r.hotspots[0].file).toBe('src/core/store.ts');
    for (let i = 1; i < r.hotspots.length; i++) {
      expect(r.hotspots[i - 1].hotspot_score).toBeGreaterThanOrEqual(r.hotspots[i].hotspot_score);
    }
  });

  it('rejects an invalid architecture POST with 400 and leaves the file untouched', async () => {
    const before = await readFile(join(fixture.flowlensDir, 'architecture.json'), 'utf-8');
    const res = await post('/architecture', { layers: [{ name: 'api', include: { patterns: ['src/api/**'] }, must_not_access: ['ghost'] }] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe('invalid_architecture_config');
    expect(body.issues[0].path).toBe('layers.0.must_not_access.0');
    expect(await readFile(join(fixture.flowlensDir, 'architecture.json'), 'utf-8')).toBe(before);
  });

  it('preview computes violations for a draft without saving', async () => {
    const before = await readFile(join(fixture.flowlensDir, 'architecture.json'), 'utf-8');
    const draft = {
      layers: [
        { name: 'ui', include: { patterns: ['src/ui/**'] } },
        { name: 'core', include: { patterns: ['src/core/**'] } },
        { name: 'api', include: { patterns: ['src/{api,x}/**'] }, must_not_access: ['ui', 'core'] },
      ],
    };
    const res = await post('/architecture/preview', draft);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; violations: Array<{ layer_to: string }> };
    expect(body.count).toBeGreaterThanOrEqual(3);
    expect(new Set(body.violations.map((v) => v.layer_to))).toEqual(new Set(['ui', 'core']));
    expect(await readFile(join(fixture.flowlensDir, 'architecture.json'), 'utf-8')).toBe(before);
  });

  it('saves a valid config and violations follow it', async () => {
    const res = await post('/architecture', { layers: [{ name: 'ui', include: { patterns: ['src/ui/**'] } }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, violation_count: 0 });
    const saved = JSON.parse(await readFile(join(fixture.flowlensDir, 'architecture.json'), 'utf-8'));
    expect(saved).toMatchObject({ version: 2, inferred_by: 'manual' });
    expect(await get<unknown[]>('/violations')).toEqual([]);
  });
});
