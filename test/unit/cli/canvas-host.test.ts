/**
 * Canvas host pieces after Phase 11: package paths, the dev host (Vite,
 * source checkout only) and its streaming proxy to the daemon (Host and
 * dev-Origin rewriting, SSE streaming). Static serving of the built SPA
 * moved into the daemon — see test/integration/explorer-daemon.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { findPackageRoot, locateCanvas } from '../../../src/cli/canvas-host/package-paths.js';
import { createApiProxy } from '../../../src/cli/canvas-host/api-proxy.js';
import { startDevHost } from '../../../src/cli/canvas-host/dev-host.js';
import { CanvasHostError } from '../../../src/contracts/canvas-host.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function listen(app: express.Express): Promise<http.Server> {
  return new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
}
const portOf = (s: http.Server) => (s.address() as AddressInfo).port;

describe('package-paths', () => {
  it('finds the flowlens package root from a nested module path', () => {
    expect(findPackageRoot(join(REPO_ROOT, 'src/cli/canvas-host/x.ts'))).toBe(REPO_ROOT);
  });

  it('returns null outside any flowlens package', () => {
    expect(findPackageRoot('/definitely/not/here/file.js')).toBeNull();
  });
});

describe('dev proxy to the daemon', () => {
  let upstream: http.Server;
  let front: http.Server;
  let frontOrigin: string;

  beforeAll(async () => {
    const up = express();
    up.get('/api/echo', (req, res) => res.json({ host: req.headers.host, origin: req.headers.origin ?? null }));
    up.get('/api/events', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write('event: hello\ndata: {}\n\n');
      setTimeout(() => res.write('event: graph-changed\ndata: {}\n\n'), 50);
    });
    upstream = await listen(up);
    const app = express();
    front = await listen(app);
    frontOrigin = `http://127.0.0.1:${portOf(front)}`;
    app.use('/api', createApiProxy(portOf(upstream), { fromOrigin: frontOrigin }));
  });

  afterAll(() => {
    front.closeAllConnections();
    upstream.closeAllConnections();
    front.close();
    upstream.close();
  });

  it('rewrites Host to the daemon and maps only the dev origin', async () => {
    const a = await (await fetch(`${frontOrigin}/api/echo`, { headers: { Origin: frontOrigin } })).json();
    expect(a).toEqual({ host: `127.0.0.1:${portOf(upstream)}`, origin: `http://127.0.0.1:${portOf(upstream)}` });
    const b = await (await fetch(`${frontOrigin}/api/echo`, { headers: { Origin: 'http://evil.example' } })).json();
    expect(b.origin).toBe('http://evil.example');
  });

  it('refuses a non-loopback Host instead of rewriting it (review L4, DNS rebinding)', async () => {
    const status = await new Promise<number>((done, fail) => {
      http.get({ host: '127.0.0.1', port: portOf(front), path: '/api/echo', headers: { Host: `evil.example:${portOf(front)}` } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }).on('error', fail);
    });
    expect(status).toBe(403);
  });

  it('streams SSE through the proxy', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${frontOrigin}/api/events`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('graph-changed')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: hello');
    ctrl.abort();
  });
});

describe('startDevHost', () => {
  it('refuses --dev outside a source checkout', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'flowlens-canvas-nodev-'));
    try {
      const p = startDevHost({ daemonPort: 1, port: 0 }, locateCanvas(tmp));
      await expect(p).rejects.toBeInstanceOf(CanvasHostError);
      await expect(p).rejects.toThrow(/source checkout/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
