import { describe, it, expect } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import type { GraphStore } from '../../../src/contracts/graph.js';
import { DEFAULT_SERVICE_OPTIONS, type ServiceOptions } from '../../../src/contracts/service.js';
import { GraphPool } from '../../../src/service/graph-pool.js';

/** Fake store recording lifecycle and write interleaving. */
function factory() {
  const opened: string[] = [];
  const closed: string[] = [];
  const log: string[] = [];
  const make = async (path: string): Promise<GraphStore> => {
    opened.push(path);
    return {
      close: async () => { closed.push(path); },
      putNode: async (e: { id: string }) => {
        log.push(`start ${e.id}`);
        await sleep(5);
        log.push(`end ${e.id}`);
      },
      getAllNodes: async () => [],
    } as unknown as GraphStore;
  };
  return { make, opened, closed, log };
}

const opts = (o: Partial<ServiceOptions> = {}): ServiceOptions => ({ ...DEFAULT_SERVICE_OPTIONS, ...o });
const P = (id: string) => ({ id, root: `/r/${id}` });

describe('GraphPool', () => {
  it('opens lazily and closes an unleased graph right after use (releaseDelayMs=0)', async () => {
    const f = factory();
    const pool = new GraphPool(opts(), f.make);
    expect(f.opened).toEqual([]);
    await pool.use(P('a'), false, (s) => s.getAllNodes());
    await sleep(5);
    expect(f.opened).toEqual(['/r/a/.flowlens/graph']);
    expect(f.closed).toEqual(['/r/a/.flowlens/graph']);
  });

  it('keeps a leased graph open, closes it on release, and idle-closes even when leased', async () => {
    const f = factory();
    const pool = new GraphPool(opts({ idleCloseMs: 30 }), f.make);
    const lease = pool.acquireLease(P('a'), {});
    await pool.use(P('a'), false, (s) => s.getAllNodes());
    await pool.use(P('a'), false, (s) => s.getAllNodes());
    expect(f.opened).toHaveLength(1);
    expect(pool.state('a')).toMatchObject({ open: true, leases: 1 });
    await sleep(40);
    await pool.sweep();
    expect(pool.state('a').open).toBe(false);
    await pool.use(P('a'), false, (s) => s.getAllNodes()); // reopens transparently
    expect(f.opened).toHaveLength(2);
    pool.releaseLease('a', lease.id);
    await sleep(5);
    expect(f.closed).toHaveLength(2);
  });

  it('serializes writes per project but not across projects', async () => {
    const f = factory();
    const pool = new GraphPool(opts(), f.make);
    pool.acquireLease(P('a'), {});
    await Promise.all([1, 2, 3].map((i) => pool.use(P('a'), true, (s) => s.putNode({ id: `a${i}` } as never))));
    expect(f.log).toEqual(['start a1', 'end a1', 'start a2', 'end a2', 'start a3', 'end a3']);
    f.log.length = 0;
    pool.acquireLease(P('b'), {});
    await Promise.all([pool.use(P('a'), true, (s) => s.putNode({ id: 'x' } as never)), pool.use(P('b'), true, (s) => s.putNode({ id: 'y' } as never))]);
    expect(f.log.slice(0, 2).sort()).toEqual(['start x', 'start y']);
  });

  it('closes the least-recently-used graph beyond maxOpenProjects', async () => {
    const f = factory();
    const pool = new GraphPool(opts({ maxOpenProjects: 2 }), f.make);
    for (const id of ['a', 'b', 'c']) {
      pool.acquireLease(P(id), {});
      await pool.use(P(id), false, (s) => s.getAllNodes());
      await sleep(2);
    }
    await sleep(5);
    expect(pool.openCount()).toBe(2);
    expect(f.closed).toEqual(['/r/a/.flowlens/graph']);
  });

  it('close() waits for in-flight writes', async () => {
    const f = factory();
    const pool = new GraphPool(opts(), f.make);
    pool.acquireLease(P('a'), {});
    const w = pool.use(P('a'), true, (s) => s.putNode({ id: 'slow' } as never));
    await sleep(1);
    await pool.close('a');
    await w;
    expect(f.log).toEqual(['start slow', 'end slow']);
    expect(f.closed).toHaveLength(1);
  });

  it('expires leases and reports watch demand changes', async () => {
    const f = factory();
    const pool = new GraphPool(opts({ leaseTtlMs: 10 }), f.make);
    const demands: boolean[] = [];
    pool.onWatchDemand((d) => demands.push(d.wanted));
    pool.acquireLease(P('a'), { watch: true });
    expect(pool.busy()).toBe(true);
    await sleep(20);
    await pool.sweep();
    expect(pool.state('a').leases).toBe(0);
    expect(pool.busy()).toBe(false);
    expect(demands).toEqual([true, false]);
  });

  it('state exposes revision and open_since (Phase 12)', async () => {
    const f = factory();
    const pool = new GraphPool(opts(), f.make);
    pool.acquireLease(P('a'), {});
    expect(pool.state('a')).toMatchObject({ open: false, revision: 0, open_since: null });
    await pool.use(P('a'), false, (s) => s.getAllNodes());
    const first = pool.state('a');
    expect(first.open).toBe(true);
    expect(typeof first.open_since).toBe('string');
    await pool.use(P('a'), true, (s) => s.putNode({ id: 'x' } as never));
    expect(pool.state('a')).toMatchObject({ revision: 1, open_since: first.open_since });
    await pool.close('a');
    expect(pool.state('a').open_since).toBeNull();
  });
});
