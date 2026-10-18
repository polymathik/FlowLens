/** `flowlens history build|show` (spawned CLI): no daemon, caches under .flowlens/history/. */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryTopology } from '../../src/contracts/history.js';
import { removeDir, runCli, tempDir } from '../helpers/service-env.js';
import { makeRichRepo, makeRepo, type Repo } from '../unit/history/git-fixture.js';

const repos: Repo[] = [];
afterAll(async () => { await Promise.all(repos.map((r) => r.cleanup())); });
const env = { FORCE_COLOR: '0' };

describe('flowlens history', () => {
  it('builds the history, a topology, and describes them', async () => {
    const r = await makeRichRepo();
    repos.push(r);
    await mkdir(join(r.dir, '.flowlens'));
    const empty = await runCli(['history', 'show'], r.dir, env);
    expect(empty.stdout).toContain('No history cached');

    const build = await runCli(['history', 'build', '--max', '6', '--topology', '--samples', '3'], r.dir, env);
    expect(build.code, build.stderr).toBe(0);
    expect(build.stdout).toContain('6 commits (newest only) on main@');
    expect(build.stdout).toContain('topology samples');

    const show = await runCli(['history', 'show'], r.dir, env);
    expect(show.stdout).toMatch(/^6 commits \(newest only\) on main@[0-9a-f]{7}, .* files seen\n3 topology samples/);
    const json = JSON.parse((await runCli(['history', 'show', '--json'], r.dir, env)).stdout) as { truncated: boolean; commits?: unknown; topology: { samples: number } };
    expect(json).toMatchObject({ truncated: true, topology: { samples: 3 } });
    expect(json.commits).toBeUndefined();
    const topo = JSON.parse(await readFile(join(r.dir, '.flowlens', 'history', 'topology.json'), 'utf8')) as HistoryTopology;
    expect(topo.samples).toHaveLength(3);

    const again = await runCli(['history', 'build', '--max', '6'], r.dir, env);
    expect(again.stdout).toContain('[cache,');
  }, 90_000);

  it('rejects bad flags, missing .flowlens and non-git directories', async () => {
    const r = await makeRepo();
    repos.push(r);
    expect((await runCli(['history', 'build'], r.dir, env)).stderr).toContain('.flowlens/ not found');
    await mkdir(join(r.dir, '.flowlens'));
    const bad = await runCli(['history', 'build', '--max', '0'], r.dir, env);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("Invalid --max '0'");
    const plain = await tempDir('flowlens-history-nogit-');
    await mkdir(join(plain, '.flowlens'));
    const nogit = await runCli(['history', 'build'], plain, env);
    expect(nogit.code).toBe(2);
    expect(nogit.stderr).toContain('not_a_git_repo');
    await removeDir(plain);
  }, 60_000);
});
