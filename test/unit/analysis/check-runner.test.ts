import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { runCheck } from '../../../src/analysis/check-runner.js';
import { loadArchConfig } from '../../../src/analysis/arch-config.js';
import type { Entity } from '../../../src/contracts/entities.js';

const file = (id: string, path: string): Entity => ({
  id, kind: 'file', name: path, qualified_name: path, file: path,
  location: { line_start: 1, line_end: 1, column_start: 0, column_end: 0 }, visibility: 'public', language: 'typescript',
});

const ARCH = {
  version: 2, inferred_by: 'manual', inferred_at: '2026-01-01',
  layers: [
    { name: 'ui', include: { patterns: ['ui/**'] }, must_not_access: ['db'] },
    { name: 'db', include: { patterns: ['db/**'] } },
  ],
};

describe('runCheck', () => {
  let dir: string;
  let graph: LevelGraphStore;
  const opts = (o = {}) => ({ flowlensDir: dir, runCycles: true, runArchitecture: true, severity: 'low' as const, ...o });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'flowlens-check-'));
    graph = new LevelGraphStore();
    await graph.open(join(dir, 'graph'));
    await graph.putNodes([file('u', 'ui/page.ts'), file('d', 'db/repo.ts')]);
    await graph.putEdges([{ id: 'r1', from: 'u', to: 'd', type: 'import', location: { file: 'ui/page.ts', line: 4, column: 0 }, weight: 1, confidence: 1 }]);
  });

  afterEach(async () => {
    await graph.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('exits 2 when architecture.json is missing (unless cycles only)', async () => {
    const r = await runCheck(graph, opts());
    expect(r.exitCode).toBe(2);
    expect(r.report.architecture).toBe('missing');
    expect((await runCheck(graph, opts({ runArchitecture: false }))).exitCode).toBe(0);
  });

  it('exits 2 on invalid architecture.json', async () => {
    await writeFile(join(dir, 'architecture.json'), JSON.stringify({ ...ARCH, layers: [{ name: 'x', include: {}, must_not_access: ['ghost'] }] }));
    const r = await runCheck(graph, opts());
    expect(r.exitCode).toBe(2);
    expect(r.problems[0]).toContain("unknown layer 'ghost'");
    await writeFile(join(dir, 'architecture.json'), '{ not json');
    expect((await loadArchConfig(dir)).status).toBe('invalid');
  });

  it('reports violations with qualified names, rule text and location; exits 1', async () => {
    await writeFile(join(dir, 'architecture.json'), JSON.stringify(ARCH));
    const r = await runCheck(graph, opts());
    expect(r.exitCode).toBe(1);
    expect(r.report.architecture_violations).toEqual([expect.objectContaining({
      rule: 'must_not_access', rule_text: "Layer 'ui' must not access 'db'",
      from: 'ui/page.ts', to: 'db/repo.ts', location: 'ui/page.ts:4',
    })]);
    expect((await runCheck(graph, opts({ scope: 'db' }))).exitCode).toBe(0);
  });
});
