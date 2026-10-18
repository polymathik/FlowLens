/**
 * Canvas host: one port serves the built SPA (static, no Vite) and proxies
 * the graph API, including the SSE stream. Assets are located from the
 * package root, never from cwd.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { startCanvasHost } from '../../../src/cli/canvas-host/static-host.js';
import { findPackageRoot, locateCanvas } from '../../../src/cli/canvas-host/package-paths.js';
import { CanvasHostError, type CanvasHost } from '../../../src/contracts/canvas-host.js';
import type { Entity } from '../../../src/contracts/entities.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function entity(id: string): Entity {
  return {
    id,
    kind: 'file',
    name: id,
    qualified_name: id,
    file: id,
    location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'typescript',
  };
}

describe('package-paths', () => {
  it('finds the flowlens package root from a nested module path', () => {
    expect(findPackageRoot(join(REPO_ROOT, 'src/cli/canvas-host/x.ts'))).toBe(REPO_ROOT);
  });

  it('returns null outside any flowlens package', () => {
    expect(findPackageRoot('/definitely/not/here/file.js')).toBeNull();
  });
});

describe('startCanvasHost (static mode)', () => {
  let tmp: string;
  let pkgRoot: string;
  let flowlensDir: string;
  let host: CanvasHost;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-canvas-host-'));
    pkgRoot = join(tmp, 'pkg');
    const app = join(pkgRoot, 'dist', 'canvas', 'app');
    await mkdir(join(app, 'assets'), { recursive: true });
    await writeFile(join(app, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(join(app, 'assets', 'index-abc.js'), 'console.log(1)');

    flowlensDir = join(tmp, 'project', '.flowlens');
    await mkdir(flowlensDir, { recursive: true });
    const store = new LevelGraphStore();
    await store.open(join(flowlensDir, 'graph'));
    await store.putNodes([entity('a.ts'), entity('b.ts')]);
    await store.close();

    host = await startCanvasHost({ flowlensDir, port: 0, mode: 'static' }, locateCanvas(pkgRoot));
  });

  afterAll(async () => {
    await host?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('binds to loopback by default', () => {
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('serves the built index.html at /', async () => {
    const res = await fetch(host.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('serves hashed assets with immutable caching', async () => {
    const res = await fetch(new URL('/assets/index-abc.js', host.url));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('404s a missing asset instead of returning index.html', async () => {
    const res = await fetch(new URL('/assets/missing.js', host.url));
    expect(res.status).toBe(404);
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await fetch(new URL('/p/123/entity/abc', host.url));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('proxies the graph API on the same port', async () => {
    const res = await fetch(new URL('/flowlens-api/summary', host.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entity_count: number };
    expect(body.entity_count).toBe(2);
  });

  it('streams SSE events through the proxy', async () => {
    const ctrl = new AbortController();
    const res = await fetch(new URL('/flowlens-api/events', host.url), { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: hello');
    host.broadcast('graph-updated', { filesReparsed: 1 });
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain('event: graph-updated');
    ctrl.abort();
  });
});

describe('startCanvasHost mode errors', () => {
  it('explains how to build when the bundle is missing in a checkout', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'flowlens-canvas-nobuild-'));
    try {
      await mkdir(join(tmp, 'src', 'canvas'), { recursive: true });
      await writeFile(join(tmp, 'src', 'canvas', 'index.html'), '');
      const p = startCanvasHost({ flowlensDir: tmp, port: 0, mode: 'static' }, locateCanvas(tmp));
      await expect(p).rejects.toBeInstanceOf(CanvasHostError);
      await expect(p).rejects.toThrow(/npm run build/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses --dev outside a source checkout', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'flowlens-canvas-nodev-'));
    try {
      const p = startCanvasHost({ flowlensDir: tmp, port: 0, mode: 'dev' }, locateCanvas(tmp));
      await expect(p).rejects.toThrow(/source checkout/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
