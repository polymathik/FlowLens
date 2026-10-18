import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { SnapshotManager } from '../../../src/analysis/snapshot-manager.js';
import { resolveSnapshotRef } from '../../../src/analysis/snapshot-refs.js';
import { ensureSnapshotForHead } from '../../../src/analysis/snapshot-service.js';
import { computeChurn } from '../../../src/analysis/churn-analyzer.js';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf-8' }).trim();

describe('snapshot refs and lifecycle', () => {
  let root: string;
  let graph: LevelGraphStore;
  let shas: string[];
  const flowlensDir = () => join(root, '.flowlens');
  const manager = () => new SnapshotManager(join(flowlensDir(), 'snapshots'));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-snap-'));
    graph = new LevelGraphStore();
    await graph.open(join(root, '.flowlens', 'graph'));
    git(root, 'init', '-q', '-b', 'main');
    shas = [];
    for (const [i, date] of ['2026-10-01T10:00:00Z', '2026-10-05T12:00:00Z'].entries()) {
      await writeFile(join(root, 'a.ts'), `export const v = ${i};\n`);
      git(root, 'add', 'a.ts');
      execFileSync('git', ['commit', '-q', '-m', `c${i}`], { cwd: root, env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
      shas.push(git(root, 'rev-parse', 'HEAD'));
      expect((await ensureSnapshotForHead({ graph, rootDir: root, flowlensDir: flowlensDir() })).status).toBe('created');
    }
    git(root, 'branch', 'old', shas[0]);
  });

  afterAll(async () => {
    await graph.close();
    await rm(root, { recursive: true, force: true });
  });

  it('is idempotent at the same HEAD and prunes to keep', async () => {
    expect(await ensureSnapshotForHead({ graph, rootDir: root, flowlensDir: flowlensDir() })).toEqual({ status: 'exists', sha: shas[1] });
    const r = await ensureSnapshotForHead({ graph, rootDir: root, flowlensDir: flowlensDir(), force: true, keep: 1 });
    expect(r).toMatchObject({ status: 'created', pruned: 1 });
    expect(Object.keys(await manager().listSnapshots())).toEqual([shas[1]]);
    await ensureSnapshotForHead({ graph, rootDir: root, flowlensDir: flowlensDir() }); // no-op
    await manager().takeSnapshot(graph, shas[0]); // restore for ref tests
  });

  it('resolves full, short, HEAD~1 and branch refs', async () => {
    for (const ref of [shas[0], shas[0].slice(0, 7), 'HEAD~1', 'old']) {
      const r = await resolveSnapshotRef(ref, manager(), root);
      expect(r.ok && r.sha, ref).toBe(shas[0]);
    }
  });

  it('rejects traversal and reports unknown refs and missing snapshots', async () => {
    expect(await resolveSnapshotRef('../config', manager(), root)).toMatchObject({ ok: false, code: 'invalid_ref' });
    expect(await resolveSnapshotRef('--help', manager(), root)).toMatchObject({ ok: false, code: 'invalid_ref' });
    expect(await resolveSnapshotRef('nope', manager(), root)).toMatchObject({ ok: false, code: 'unknown_ref' });
    await writeFile(join(root, 'a.ts'), 'export const v = 9;\n');
    git(root, 'commit', '-qam', 'c3');
    const r = await resolveSnapshotRef('HEAD', manager(), root);
    expect(r).toMatchObject({ ok: false, code: 'no_snapshot' });
    expect(!r.ok && r.suggestions.join(' ')).toContain('flowlens snapshot');
  });

  it('churn reports the real last-changed date per file', async () => {
    const churn = await computeChurn(root, { since: '2026-09-01' });
    const a = churn.get('a.ts')!;
    expect(a.change_count).toBe(3);
    expect(Date.parse(a.last_changed)).toBeGreaterThanOrEqual(Date.parse('2026-10-05T12:00:00Z'));
  });
});
