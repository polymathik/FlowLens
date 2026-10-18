/**
 * Parser truth 2 golden: module-scope owners (item 4) and call sites (item 3)
 * on the `parser-truth-2` fixture (Hono-like server, SvelteKit-like web app).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexFixture, findEdge, type IndexedFixture } from './harness.js';

const FIXTURE = join(import.meta.dirname, '../fixtures/parser-truth-2');
const APP = 'apps/server/src/app.ts';

/** 1-based line of the first/`nth` line containing `needle` in a fixture file. */
function lineOf(file: string, needle: string, nth = 1): number {
  const lines = readFileSync(join(FIXTURE, file), 'utf-8').split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle) && ++seen === nth) return i + 1;
  throw new Error(`${needle} not in ${file}`);
}

let fx: IndexedFixture | null = null;
afterEach(async () => { await fx?.cleanup(); fx = null; });

describe('module-scope owners and call sites', () => {
  it('attributes route callbacks and top-level calls to the file entity, keeping every site', async () => {
    fx = await indexFixture(FIXTURE);
    const health = findEdge(fx, 'call', APP, `${APP}/health`);
    expect(health?.meta?.owner).toBe('module');
    expect(health?.location.line).toBe(lineOf(APP, "app.get('/health'"));
    const audit = findEdge(fx, 'call', APP, `${APP}/audit`);
    expect(audit?.weight).toBe(2);
    expect(audit?.meta?.sites?.map((s) => s.line)).toEqual([lineOf(APP, "audit(id ?? '')"), lineOf(APP, "audit('again')")]);
    expect(audit?.meta?.sites_total).toBe(2);
    expect(findEdge(fx, 'call', APP, 'packages/core/src/ids.ts/parseId')?.meta?.owner).toBe('module');
    expect(findEdge(fx, 'call', APP, 'apps/server/src/boot.ts/boot')?.location.line).toBe(lineOf(APP, 'boot(app);'));
  });

  it('keeps callbacks of a named function with that function', async () => {
    fx = await indexFixture(FIXTURE);
    const inner = findEdge(fx, 'call', `${APP}/listRoutes`, `${APP}/health`);
    expect(inner).toBeDefined();
    expect(inner?.meta?.owner).toBeUndefined();
    // the file entity has no edge for that call: it is owned by listRoutes
    expect(fx.edges.filter((e) => e.type === 'call' && fx!.byId.get(e.from)?.kind === 'file' && e.meta?.sites?.some((s) => s.line === lineOf(APP, 'items.filter')))).toEqual([]);
  });

  it('call edges from file entities have valid endpoints (no dangling edges)', async () => {
    fx = await indexFixture(FIXTURE);
    expect(fx.edges.filter((e) => !fx!.byId.has(e.from) || !fx!.byId.has(e.to))).toEqual([]);
    const fromFile = fx.edges.filter((e) => e.type === 'call' && fx!.byId.get(e.from)?.kind === 'file');
    expect(fromFile.length).toBeGreaterThanOrEqual(4);
    expect(fromFile.every((e) => e.meta?.owner === 'module')).toBe(true);
  });
});
