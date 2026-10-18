import { describe, it, expect, afterEach } from 'vitest';
import { buildCanvasUrl } from '../../../src/contracts/canvas-links.js';

describe('buildCanvasUrl', () => {
  const savedEnv = process.env.FLOWLENS_CANVAS_URL;
  const savedPort = process.env.FLOWLENS_DAEMON_PORT;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.FLOWLENS_CANVAS_URL;
    } else {
      process.env.FLOWLENS_CANVAS_URL = savedEnv;
    }
    if (savedPort === undefined) delete process.env.FLOWLENS_DAEMON_PORT;
    else process.env.FLOWLENS_DAEMON_PORT = savedPort;
  });

  it('defaults to the explorer the daemon serves on 127.0.0.1:4280', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    delete process.env.FLOWLENS_DAEMON_PORT;
    const url = buildCanvasUrl({ kind: 'entity', identifier: 'UserService' });
    expect(url).toBe('http://127.0.0.1:4280/#/entity/UserService');
  });

  it('honours FLOWLENS_DAEMON_PORT, and the running daemon port over it', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    process.env.FLOWLENS_DAEMON_PORT = '5000';
    expect(buildCanvasUrl({ kind: 'file', identifier: 'a.ts' })).toBe('http://127.0.0.1:5000/#/file/a.ts');
    expect(buildCanvasUrl({ kind: 'file', identifier: 'a.ts', daemonPort: 6123 })).toBe('http://127.0.0.1:6123/#/file/a.ts');
  });

  it('includes the project id in the explorer map route', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    delete process.env.FLOWLENS_DAEMON_PORT;
    const url = buildCanvasUrl({ kind: 'file', identifier: 'src/a.ts', projectId: 'p1', overlay: 'cycles' });
    expect(url).toBe('http://127.0.0.1:4280/#/p/p1/map/file/src%2Fa.ts?overlay=cycles');
  });

  it('project links parse back with the explorer router', async () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    const { parseExplorerHash } = await import('../../../src/canvas/router/explorer-route.js');
    const url = buildCanvasUrl({ kind: 'entity', identifier: 'src/a.ts/Foo.bar', projectId: 'abc', overlay: 'complexity' });
    expect(parseExplorerHash(url.slice(url.indexOf('#')))).toEqual({
      tab: 'project', projectId: 'abc', view: 'map',
      target: { kind: 'entity', identifier: 'src/a.ts/Foo.bar' }, overlay: 'complexity',
    });
  });

  it('percent-encodes identifiers with slashes', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    const url = buildCanvasUrl({
      kind: 'file',
      identifier: 'src/auth/UserService.ts',
    });
    expect(url).toContain('%2F');
    expect(url).toContain('UserService.ts');
  });

  it('appends overlay query param when provided', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    const url = buildCanvasUrl({
      kind: 'entity',
      identifier: 'Foo',
      overlay: 'complexity',
    });
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#\/entity\/Foo\?overlay=complexity$/);
  });

  it('respects FLOWLENS_CANVAS_URL env var', () => {
    process.env.FLOWLENS_CANVAS_URL = 'https://canvas.example.com';
    const url = buildCanvasUrl({ kind: 'module', identifier: 'api' });
    expect(url).toBe('https://canvas.example.com/#/module/api');
  });

  it('strips trailing slash from base URL', () => {
    process.env.FLOWLENS_CANVAS_URL = 'https://example.com/';
    const url = buildCanvasUrl({ kind: 'entity', identifier: 'X' });
    expect(url).toBe('https://example.com/#/entity/X');
  });

  it('baseUrl option beats env var', () => {
    process.env.FLOWLENS_CANVAS_URL = 'https://env.example.com';
    const url = buildCanvasUrl({
      kind: 'entity',
      identifier: 'X',
      baseUrl: 'https://override.example.com',
    });
    expect(url).toBe('https://override.example.com/#/entity/X');
  });

  it('supports all three kinds', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    expect(buildCanvasUrl({ kind: 'entity', identifier: 'X' })).toContain('/entity/');
    expect(buildCanvasUrl({ kind: 'module', identifier: 'X' })).toContain('/module/');
    expect(buildCanvasUrl({ kind: 'file', identifier: 'X' })).toContain('/file/');
  });

  it('supports all six overlay types', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    const overlays = ['complexity', 'churn', 'hotspot', 'cycles', 'violations', 'diff'] as const;
    for (const overlay of overlays) {
      const url = buildCanvasUrl({ kind: 'entity', identifier: 'X', overlay });
      expect(url).toContain(`?overlay=${overlay}`);
    }
  });
});
