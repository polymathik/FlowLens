import { describe, it, expect, afterEach } from 'vitest';
import { buildCanvasUrl } from '../../../src/contracts/canvas-links.js';

describe('buildCanvasUrl', () => {
  const savedEnv = process.env.FLOWLENS_CANVAS_URL;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.FLOWLENS_CANVAS_URL;
    } else {
      process.env.FLOWLENS_CANVAS_URL = savedEnv;
    }
  });

  it('builds a default entity URL on localhost:5173', () => {
    delete process.env.FLOWLENS_CANVAS_URL;
    const url = buildCanvasUrl({ kind: 'entity', identifier: 'UserService' });
    expect(url).toBe('http://localhost:5173/#/entity/UserService');
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
    expect(url).toBe('http://localhost:5173/#/entity/Foo?overlay=complexity');
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
