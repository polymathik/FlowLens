/**
 * Wave 2 graph access: every agent graph open goes through openGraphStore
 * (injected here), lock errors from the daemon (`graph_locked`) and from a
 * direct open are "busy", anything else is an explicit "error".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphStore } from '../../../src/contracts/graph.js';
import {
  BUSY_HINT_DAEMON, BUSY_HINT_DIRECT, describeGraphFailure, isGraphLockedError, openAgentGraph, type GraphOpener,
} from '../../../src/agent/graph-access.js';
import { RemoteServiceError } from '../../../src/service/errors.js';
import { HOOK_STORE_TIMEOUTS } from '../../../src/contracts/open-graph.js';
import { InMemoryGraph } from '../../../src/agent/memory-graph.js';

describe('openAgentGraph via openGraphStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-graph-access-'));
    await mkdir(join(root, '.flowlens', 'graph'), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('opens with client "hook", passes --no-daemon through, and probes the store', async () => {
    const calls: Array<{ client?: string; daemon?: boolean }> = [];
    let probed = false;
    const open: GraphOpener = async (_root, o) => {
      calls.push(o);
      const g = new InMemoryGraph([], []) as unknown as GraphStore;
      const getNode = g.getNode.bind(g);
      g.getNode = async (id: string) => { probed = true; return getNode(id); };
      return g;
    };
    const handle = await openAgentGraph(root, { open, daemon: false });
    expect(handle.ok).toBe(true);
    expect(calls).toEqual([{ client: 'hook', daemon: false, ...HOOK_STORE_TIMEOUTS }]);
    expect(probed).toBe(true);
  });

  it('reports busy (daemon wording) when the daemon answers graph_locked on the first RPC, after retrying', async () => {
    let opens = 0;
    let closes = 0;
    const open: GraphOpener = async () => {
      opens++;
      return {
        getNode: async () => { throw new RemoteServiceError('graph_locked', 'locked', 423); },
        close: async () => { closes++; },
      } as unknown as GraphStore;
    };
    const result = await openAgentGraph(root, { open, attempts: 3, delayMs: 1 });
    expect(result).toEqual({ ok: false, reason: 'busy', message: BUSY_HINT_DAEMON });
    expect(opens).toBe(3);
    expect(closes).toBe(3);
  });

  it('uses the --no-daemon wording for a direct LevelDB lock and an explicit error otherwise', async () => {
    const lock = Object.assign(new Error('Database failed to open'), { cause: Object.assign(new Error('IO error: lock hold by current process'), { code: 'LEVEL_LOCKED' }) });
    expect(isGraphLockedError(lock)).toBe(true);
    expect(describeGraphFailure(lock, { daemon: false }).message).toBe(BUSY_HINT_DIRECT);

    const failing: GraphOpener = async () => { throw new Error('FlowLens daemon did not answer within 15000 ms.'); };
    const result = await openAgentGraph(root, { open: failing, attempts: 3, delayMs: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.message).toContain('did not answer');
      expect(result.message).toContain('flowlens daemon status');
    }
    expect(isGraphLockedError(new RemoteServiceError('internal', 'boom', 500))).toBe(false);
  });

  it('reports missing without opening anything', async () => {
    await rm(join(root, '.flowlens'), { recursive: true });
    const result = await openAgentGraph(root, { open: async () => { throw new Error('must not open'); } });
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
  });
});
