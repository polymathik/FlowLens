import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryError, type HistorySummary } from '../../../src/contracts/history.js';
import { buildHistory, type BuildHistoryInput } from '../../../src/history/commits.js';
import { commitsPath } from '../../../src/history/cache.js';
import { createFileFilter, loadFileFilter } from '../../../src/history/file-filter.js';
import { FALLBACK_CONFIG } from '../../../src/projects/config.js';
import { makeRepo, makeRichRepo, type Repo } from './git-fixture.js';

const repos: Repo[] = [];
afterEach(async () => { await Promise.all(repos.splice(0).map((r) => r.cleanup())); });
const track = <T extends Repo>(r: T): T => { repos.push(r); return r; };

async function build(r: Repo, o: Partial<BuildHistoryInput> = {}, root = r.dir): Promise<HistorySummary> {
  const filter = await loadFileFilter(root, FALLBACK_CONFIG);
  return buildHistory({ rootDir: root, flowlensDir: join(r.dir, '.flowlens'), filter, ...o });
}
/** What must not depend on how the summary was produced. */
const essence = (h: HistorySummary): unknown => ({ ...h, built_at: 0, build: 0 });
const ts = (n: number): string => `export const v = ${n};\n`;

describe('buildHistory', () => {
  it('reads statuses, LOC, renames, deletes, binary files; serves only author names', async () => {
    const r = track(await makeRichRepo());
    const h = await build(r);
    expect(h.commits).toHaveLength(8);
    expect(h.truncated).toBe(false);
    expect(h.branch).toBe('main');
    expect(h.head).toBe(r.sha());
    expect(h.build).toMatchObject({ mode: 'full', commits_read: 8 });
    const [first, edit, rename, empty, docsOnly, del] = h.commits;
    expect(first.files.find((f) => f.path === 'assets/blob.json')).toEqual({ path: 'assets/blob.json', status: 'A', added: 0, deleted: 0 });
    expect(first.files.map((f) => f.path)).not.toContain('README.md'); // .md is not on the map
    expect(edit.files).toEqual([{ path: 'src/a.ts', status: 'M', added: 2, deleted: 1 }]);
    expect(rename.files).toEqual([{ path: 'lib/new-name.ts', status: 'R', from: 'src/old-name.ts', added: 1, deleted: 0 }]);
    expect(empty.files).toEqual([]);
    expect(docsOnly.files).toEqual([{ path: 'assets/blob.json', status: 'M', added: 0, deleted: 0 }]);
    expect(del.files).toEqual([{ path: 'src/a.ts', status: 'D', added: 0, deleted: 3 }]);
    expect(h.totals).toMatchObject({ commits: 8, files_ever: 8, first_date: first.date, last_date: h.commits[7].date });
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/example\.invalid|@/); // no e-mail addresses anywhere
    expect(h.commits.map((c) => c.date)).toEqual([...h.commits.map((c) => c.date)].sort());
  });

  it('first-parent mode lists the merge, diffed against its first parent', async () => {
    const r = track(await makeRichRepo());
    const h = await build(r, { firstParent: true });
    expect(h.first_parent).toBe(true);
    const merge = h.commits[h.commits.length - 1];
    expect(merge.subject).toBe('merge feature');
    expect(merge.parents).toHaveLength(2);
    expect(merge.files).toEqual([{ path: 'feature/f.ts', status: 'A', added: 1, deleted: 0 }]);
    // different mode = different cache
    expect((await build(r)).build?.mode).toBe('full');
  });

  it('serves the cache while HEAD is unchanged', async () => {
    const r = track(await makeRichRepo());
    const a = await build(r);
    const b = await build(r);
    expect(b.build).toMatchObject({ mode: 'cache', commits_read: 0 });
    expect(essence(b)).toEqual(essence(a));
  });

  it('appends only the new commits when HEAD advanced (incremental) and matches a full rebuild', async () => {
    const r = track(await makeRichRepo());
    await build(r);
    await r.write('src/new.ts', ts(1));
    await r.write('lib/new-name.ts', ts(2));
    r.commit('add new, change lib');
    await r.write('src/new.ts', ts(3));
    r.commit('edit new');
    const inc = await build(r);
    expect(inc.build).toMatchObject({ mode: 'incremental', commits_read: 2 });
    expect(inc.commits).toHaveLength(10);
    const full = await build(r, { force: true });
    expect(full.build?.mode).toBe('full');
    expect(essence(inc)).toEqual(essence(full));
  });

  it('rebuilds when history was rewritten (reset + new commit, amend)', async () => {
    const r = track(await makeRichRepo());
    const before = await build(r);
    r.git('reset', '-q', '--hard', 'HEAD~3');
    await r.write('src/other.ts', ts(1));
    r.commit('diverge');
    const after = await build(r);
    expect(after.build?.mode).toBe('full');
    expect(after.commits.map((c) => c.sha)).not.toContain(before.head);
    expect(after.commits[after.commits.length - 1].subject).toBe('diverge');

    await r.write('src/other.ts', ts(2));
    r.git('add', '-A');
    r.git('commit', '-q', '--amend', '-m', 'diverge (amended)');
    const amended = await build(r);
    expect(amended.build?.mode).toBe('full');
    expect(amended.commits[amended.commits.length - 1].subject).toBe('diverge (amended)');
    expect(amended.commits).toHaveLength(after.commits.length);
  });

  it('caps at --max, keeps the newest, and records the files that existed before the window (baseline)', async () => {
    const r = track(await makeRichRepo());
    const h = await build(r, { max: 3 });
    expect(h.truncated).toBe(true);
    expect(h.commits).toHaveLength(3);
    expect(h.commits[2].sha).toBe(r.sha('HEAD^1')); // HEAD is the merge, which --no-merges leaves out
    const oldest = h.commits[0].sha;
    const lsTree = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', `${oldest}^1`], { cwd: r.dir, encoding: 'utf8' }).split('\0')
      .filter((p) => /\.(ts|json)$/.test(p));
    expect([...(h.baseline ?? [])].sort()).toEqual(lsTree.sort());
  });

  it('incremental trimming folds dropped commits into the baseline (same as a fresh capped build, linear history)', async () => {
    const r = track(await makeRepo());
    for (let i = 0; i < 6; i++) { await r.write(`src/f${i}.ts`, ts(i)); r.commit(`seed ${i}`); }
    await r.mv('src/f0.ts', 'lib/f0.ts');
    r.commit('move f0');
    await build(r, { max: 4 });
    await r.write('src/g0.ts', ts(1));
    await r.write('src/f1.ts', ts(7));
    r.commit('grow');
    r.git('rm', '-q', 'src/f2.ts');
    r.commit('remove f2');
    const inc = await build(r, { max: 4 });
    expect(inc.build).toMatchObject({ mode: 'incremental', commits_read: 2 });
    expect(inc.commits.map((c) => c.subject)).toEqual(['seed 5', 'move f0', 'grow', 'remove f2']);
    const fresh = await build(r, { max: 4, force: true });
    expect(essence(inc)).toEqual(essence(fresh));
    expect([...(inc.baseline ?? [])].sort()).toEqual(['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts', 'src/f4.ts']);
  });

  it('starts over when more commits arrived than fit', async () => {
    const r = track(await makeRichRepo());
    await build(r, { max: 3 });
    for (let i = 0; i < 4; i++) { await r.write(`src/h${i}.ts`, ts(i)); r.commit(`more ${i}`); }
    const h = await build(r, { max: 3 });
    expect(h.build?.mode).toBe('full');
    expect(h.commits.map((c) => c.subject)).toEqual(['more 1', 'more 2', 'more 3']);
  });

  it('applies the ignore rules and rebuilds when they change', async () => {
    const r = track(await makeRichRepo());
    const withLib = await build(r);
    expect(withLib.commits.flatMap((c) => c.files.map((f) => f.path))).toContain('lib/new-name.ts');
    await writeFile(join(r.dir, '.flowlensignore'), 'lib/\n');
    const without = await build(r);
    expect(without.build?.mode).toBe('full'); // filter key changed
    const paths = without.commits.flatMap((c) => c.files.map((f) => f.path));
    expect(paths).not.toContain('lib/new-name.ts');
    // renamed into an ignored dir = deleted from the map's point of view
    expect(without.commits[2].files).toEqual([{ path: 'src/old-name.ts', status: 'D', added: 0, deleted: 0 }]);
  });

  it('reports typed errors for non-git directories, empty repositories and missing directories', async () => {
    const plain = track(await makeRepo({ init: false }));
    await expect(build(plain)).rejects.toMatchObject({ code: 'not_a_git_repo' });
    const empty = track(await makeRepo());
    await expect(build(empty)).rejects.toMatchObject({ code: 'no_commits' });
    await expect(build(empty, {}, join(empty.dir, 'missing'))).rejects.toMatchObject({ code: 'not_a_git_repo' });
    await expect(build(empty, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(HistoryError);
  });

  it('recovers from a corrupt cache file', async () => {
    const r = track(await makeRichRepo());
    await build(r);
    await writeFile(commitsPath(join(r.dir, '.flowlens')), '{"version":1,"head":');
    const h = await build(r);
    expect(h.build?.mode).toBe('full');
    expect(h.commits).toHaveLength(8);
  });

  it('marks shallow clones and keeps working', async () => {
    const r = track(await makeRichRepo());
    const parent = track(await makeRepo({ init: false }));
    const clone = join(parent.dir, 'clone');
    execFileSync('git', ['clone', '-q', '--depth', '3', '--no-local', `file://${r.dir}`, clone]);
    const h = await buildHistory({
      rootDir: clone, flowlensDir: join(clone, '.flowlens'), filter: await loadFileFilter(clone, FALLBACK_CONFIG),
    });
    expect(h.shallow).toBe(true);
    expect(h.commits.length).toBeLessThanOrEqual(3);
    expect(h.commits.length).toBeGreaterThan(0);
    // the boundary commit looks like a root: everything it contains is "added"
    expect(h.commits[0].files.every((f) => f.status === 'A')).toBe(true);
  });

  it('works for a project below the repository root (paths relative to the project)', async () => {
    const r = track(await makeRepo());
    await r.write('packages/app/src/a.ts', ts(1));
    await r.write('packages/lib/src/b.ts', ts(2));
    r.commit('both');
    await r.write('packages/lib/src/b.ts', ts(3));
    r.commit('only lib');
    await r.write('packages/app/src/a.ts', ts(4));
    r.commit('only app');
    const root = join(r.dir, 'packages', 'app');
    await mkdir(join(root, '.flowlens'), { recursive: true });
    const h = await build(r, {}, root);
    expect(h.commits.map((c) => c.subject)).toEqual(['both', 'only app']); // commits not touching the project are left out
    expect(h.commits[0].files).toEqual([{ path: 'src/a.ts', status: 'A', added: 1, deleted: 0 }]);
  });

  it('stops at the byte cap keeping the newest commits', async () => {
    const r = track(await makeRepo());
    for (let i = 0; i < 12; i++) { await r.write(`src/f${i}.ts`, ts(i)); r.commit(`c${i}`); }
    const h = await build(r, { maxBytes: 1500 });
    expect(h.truncated).toBe(true);
    expect(h.commits.length).toBeGreaterThan(0);
    expect(h.commits.length).toBeLessThan(12);
    expect(h.commits[h.commits.length - 1].subject).toBe('c11');
    h.commits.forEach((c) => expect(c.files.length).toBe(1)); // no half-read commit
  });
});

describe('file filter', () => {
  it('matches discovery: extension, no dot segments, ignore patterns', () => {
    const f = createFileFilter(['dist/', '*.test.ts'], ['.ts', '.json']);
    expect(f.accepts('src/a.ts')).toBe(true);
    expect(f.accepts('src/a.test.ts')).toBe(false);
    expect(f.accepts('dist/x.ts')).toBe(false);
    expect(f.accepts('.github/x.json')).toBe(false);
    expect(f.accepts('README.md')).toBe(false);
    expect(createFileFilter(['dist/'], ['.ts']).key).not.toBe(createFileFilter(['build/'], ['.ts']).key);
  });
});
