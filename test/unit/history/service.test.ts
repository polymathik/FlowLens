import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryError } from '../../../src/contracts/history.js';
import { HistoryService } from '../../../src/history/service.js';
import { commitsPath, topologyPath } from '../../../src/history/cache.js';
import { makeRepo, type Repo } from './git-fixture.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((f) => f())); });

async function repoWith(n: number): Promise<Repo> {
  const r = await makeRepo();
  cleanups.push(() => r.cleanup());
  for (let i = 0; i < n; i++) {
    await r.write(`src/f${i}.ts`, i > 0 ? `import { v${i - 1} } from './f${i - 1}';\nexport const v${i} = v${i - 1} + 1;\n` : 'export const v0 = 0;\n');
    r.commit(`c${i}`);
  }
  return r;
}
const ref = (r: Repo): { id: string; root: string } => ({ id: 'p1', root: r.dir });

describe('HistoryService.summary', () => {
  it('shares one build between concurrent callers (single-flight)', async () => {
    const r = await repoWith(4);
    const svc = new HistoryService({ minIntervalMs: 0 });
    const results = await Promise.all(Array.from({ length: 6 }, () => svc.summary(ref(r))));
    expect(new Set(results).size).toBe(1); // the very same object
    expect(results[0].build?.mode).toBe('full');
    expect((await svc.summary(ref(r))).build?.mode).toBe('cache');
  });

  it('reuses a result for the rate-limit interval, then picks up new commits incrementally', async () => {
    const r = await repoWith(3);
    let now = 1_000;
    const svc = new HistoryService({ minIntervalMs: 1000, now: () => now });
    const first = await svc.summary(ref(r));
    await r.write('src/new.ts', 'export const n = 1;\n');
    r.commit('new');
    now += 500;
    expect(await svc.summary(ref(r))).toBe(first); // within the window: no git at all
    now += 600;
    const second = await svc.summary(ref(r));
    expect(second.commits).toHaveLength(4);
    expect(second.build).toMatchObject({ mode: 'incremental', commits_read: 1 });
  });

  it('remembers failures for the interval too, and builds different options separately', async () => {
    const plain = await makeRepo({ init: false });
    cleanups.push(() => plain.cleanup());
    const svc = new HistoryService({ minIntervalMs: 60_000 });
    const e1 = await svc.summary(ref(plain)).catch((e: unknown) => e);
    const e2 = await svc.summary(ref(plain)).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(HistoryError);
    expect((e1 as HistoryError).code).toBe('not_a_git_repo');
    expect(e2).toBe(e1);

    const r = await repoWith(5);
    const s2 = new HistoryService({ minIntervalMs: 0 });
    const [a, b] = await Promise.all([s2.summary(ref(r), { max: 5 }), s2.summary(ref(r), { max: 2 })]);
    expect(a.commits).toHaveLength(5);
    expect(b.commits).toHaveLength(2);
    expect(b.truncated).toBe(true);
  });
});

describe('HistoryService topology jobs', () => {
  it('runs one job at a time with progress, stores the result, and 409s a second start', async () => {
    const r = await repoWith(4);
    const svc = new HistoryService({ minIntervalMs: 0 });
    await expect(svc.topology(ref(r))).rejects.toMatchObject({ code: 'not_built' });
    expect(svc.status(ref(r))).toMatchObject({ state: 'idle', job_id: null });

    const started = await svc.startTopology(ref(r));
    expect(started).toMatchObject({ state: 'running' });
    expect(started.job_id).toMatch(/^[0-9a-f]{12}$/);
    const second = await svc.startTopology(ref(r)).catch((e: unknown) => e);
    expect(second).toMatchObject({ code: 'job_running', jobId: started.job_id });

    await svc.idle(ref(r));
    const done = svc.status(ref(r));
    expect(done).toMatchObject({ state: 'done', job_id: started.job_id, error: null });
    expect(done.progress).toMatchObject({ done: 4, total: 4, skipped: 0, current: null });
    expect(done.finished_at).not.toBeNull();
    const topo = await svc.topology(ref(r));
    expect(topo.samples).toHaveLength(4);
    expect(topo.samples[3].edges.length).toBeGreaterThan(0);

    const again = await svc.startTopology(ref(r)); // a new job after the previous finished
    expect(again.job_id).not.toBe(started.job_id);
    await svc.idle(ref(r));
    expect(svc.status(ref(r)).progress).toMatchObject({ reused: 4 }); // incremental: nothing to parse
  });

  it('cancels a running job (nothing is written) and clear() removes both caches', async () => {
    const r = await repoWith(6);
    const svc = new HistoryService({ minIntervalMs: 0 });
    const s = await svc.startTopology(ref(r));
    const cancelled = await svc.cancel(ref(r));
    expect(cancelled).toMatchObject({ state: 'cancelled', job_id: s.job_id });
    await expect(readFile(topologyPath(join(r.dir, '.flowlens')))).rejects.toThrow();
    expect((await svc.cancel(ref(r))).state).toBe('cancelled'); // idempotent

    await svc.startTopology(ref(r));
    await svc.idle(ref(r));
    expect(await readFile(commitsPath(join(r.dir, '.flowlens')), 'utf8')).toContain('"commits"');
    const removed = await svc.clear(ref(r));
    expect(removed.sort()).toEqual(['commits.json', 'topology.json']);
    await expect(readFile(commitsPath(join(r.dir, '.flowlens')))).rejects.toThrow();
    expect(svc.status(ref(r)).state).toBe('idle');
    await expect(svc.topology(ref(r))).rejects.toMatchObject({ code: 'not_built' });
  });

  it('fails fast (no job) outside a git repository, and reports an internal failure as a failed job', async () => {
    const plain = await makeRepo({ init: false });
    cleanups.push(() => plain.cleanup());
    const svc = new HistoryService({ minIntervalMs: 0 });
    await expect(svc.startTopology(ref(plain))).rejects.toMatchObject({ code: 'not_a_git_repo' });
    expect(svc.status(ref(plain)).state).toBe('idle');

    const r = await repoWith(2);
    await mkdir(topologyPath(join(r.dir, '.flowlens')), { recursive: true }); // a directory where the file must go
    await svc.startTopology(ref(r));
    await svc.idle(ref(r));
    expect(svc.status(ref(r))).toMatchObject({ state: 'failed', error: { code: 'internal' } });
  });
});
