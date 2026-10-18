/**
 * GraphPool — the daemon's set of open project graphs.
 *
 * - Lazy open: a project's LevelGraphStore opens on first use.
 * - Leases pin a project open; expired leases are swept.
 * - Unpinned graphs close `releaseDelayMs` after last use; any graph closes
 *   after `idleCloseMs` without requests; at most `maxOpenProjects` stay open
 *   (least-recently-used closes first). A closed graph reopens transparently.
 * - Writes are serialized per project (a promise chain); reads run freely.
 * - `close()` waits for in-flight calls and queued writes before closing.
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { GraphStore } from '../contracts/graph.js';
import type { ProjectGraphState, ServiceOptions } from '../contracts/service.js';
import { projectGraphPath } from '../projects/paths.js';
import { toServiceError } from './errors.js';

export interface PoolProject {
  id: string;
  root: string;
}

export interface Lease {
  id: string;
  expiresAt: number;
  watch: boolean;
  debounceMs: number;
  client: string;
}

export type StoreFactory = (graphPath: string) => Promise<GraphStore>;

export interface WatchDemand {
  project: PoolProject;
  wanted: boolean;
  debounceMs: number;
}

interface Entry {
  project: PoolProject;
  store: GraphStore | null;
  opening: Promise<GraphStore> | null;
  closing: Promise<void> | null;
  inflight: number;
  writeChain: Promise<unknown>;
  leases: Map<string, Lease>;
  lastUsed: number;
  /** Epoch ms the current store was opened (0 while closed). */
  openedAt: number;
  releaseTimer: NodeJS.Timeout | null;
}

export class GraphPool {
  private entries = new Map<string, Entry>();
  /** Graph revision per project: bumps after every write and on evict (explorer caches key on it). */
  private revisions = new Map<string, number>();
  private watchDemandListener: (d: WatchDemand) => void = () => {};

  constructor(
    private readonly opts: ServiceOptions,
    private readonly openStore: StoreFactory,
    private readonly isWatched: (id: string) => boolean = () => false,
  ) {}

  onWatchDemand(listener: (d: WatchDemand) => void): void {
    this.watchDemandListener = listener;
  }

  /**
   * Run `fn` against the project's open store (opening it if needed).
   * `releaseDelayMs` overrides how long an unpinned DB stays open afterwards.
   */
  async use<T>(project: PoolProject, write: boolean, fn: (s: GraphStore) => Promise<T>, releaseDelayMs?: number): Promise<T> {
    const e = this.entry(project);
    while (e.closing) await e.closing;
    e.inflight++;
    e.lastUsed = Date.now();
    try {
      const store = await this.ensureOpen(e);
      if (!write) return await fn(store);
      const run = e.writeChain.then(() => fn(store));
      e.writeChain = run.catch(() => undefined);
      try {
        return await run;
      } finally {
        this.bumpRevision(project.id);
      }
    } finally {
      e.inflight--;
      e.lastUsed = Date.now();
      this.scheduleRelease(e, releaseDelayMs);
    }
  }

  acquireLease(project: PoolProject, o: { watch?: boolean; debounceMs?: number; client?: string }): Lease {
    const e = this.entry(project);
    const lease: Lease = {
      id: randomBytes(12).toString('hex'),
      expiresAt: Date.now() + this.opts.leaseTtlMs,
      watch: o.watch === true,
      debounceMs: o.debounceMs ?? 300,
      client: o.client ?? 'client',
    };
    e.leases.set(lease.id, lease);
    this.cancelRelease(e);
    if (lease.watch) this.emitWatchDemand(e);
    return lease;
  }

  renewLease(projectId: string, leaseId: string): boolean {
    const lease = this.entries.get(projectId)?.leases.get(leaseId);
    if (!lease) return false;
    lease.expiresAt = Date.now() + this.opts.leaseTtlMs;
    return true;
  }

  releaseLease(projectId: string, leaseId: string): boolean {
    const e = this.entries.get(projectId);
    const lease = e?.leases.get(leaseId);
    if (!e || !lease) return false;
    e.leases.delete(leaseId);
    if (lease.watch) this.emitWatchDemand(e);
    this.scheduleRelease(e);
    return true;
  }

  /** Current graph revision of a project (0 until the first write this session). */
  revision(projectId: string): number {
    return this.revisions.get(projectId) ?? 0;
  }

  bumpRevision(projectId: string): void {
    this.revisions.set(projectId, this.revision(projectId) + 1);
  }

  /** Close the project's DB (waits for in-flight work). Leases are kept unless `dropLeases`. */
  async close(projectId: string, dropLeases = false): Promise<void> {
    if (dropLeases) this.bumpRevision(projectId);
    const e = this.entries.get(projectId);
    if (!e) return;
    if (dropLeases && e.leases.size > 0) {
      const hadWatch = [...e.leases.values()].some((l) => l.watch);
      e.leases.clear();
      if (hadWatch) this.emitWatchDemand(e);
    }
    this.cancelRelease(e);
    if (e.closing) return e.closing;
    e.closing = (async () => {
      while (e.inflight > 0) await sleep(2);
      await e.writeChain;
      if (e.opening) await e.opening.catch(() => undefined);
      const store = e.store;
      e.store = null;
      e.openedAt = 0;
      if (store) await store.close().catch(() => undefined);
    })().finally(() => {
      e.closing = null;
    });
    return e.closing;
  }

  /** Re-evaluate whether an unpinned project can release its DB (e.g. after its watcher stopped). */
  recheck(projectId: string): void {
    const e = this.entries.get(projectId);
    if (e) this.scheduleRelease(e);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id, true)));
  }

  /** Periodic housekeeping; the daemon calls this on a timer. */
  async sweep(now = Date.now()): Promise<void> {
    for (const e of this.entries.values()) {
      for (const [id, lease] of e.leases) {
        if (lease.expiresAt <= now) this.releaseLease(e.project.id, id);
      }
      if (e.store && e.inflight === 0 && now - e.lastUsed >= this.opts.idleCloseMs) {
        await this.close(e.project.id);
      }
    }
  }

  state(projectId: string): ProjectGraphState {
    const e = this.entries.get(projectId);
    return {
      open: Boolean(e?.store),
      leases: e?.leases.size ?? 0,
      watching: this.isWatched(projectId),
      last_used: e && e.lastUsed > 0 ? new Date(e.lastUsed).toISOString() : null,
      revision: this.revision(projectId),
      open_since: e?.store && e.openedAt > 0 ? new Date(e.openedAt).toISOString() : null,
    };
  }

  leases(projectId: string): Lease[] {
    return [...(this.entries.get(projectId)?.leases.values() ?? [])];
  }

  /** True while any project has a lease or an in-flight request. */
  busy(): boolean {
    for (const e of this.entries.values()) if (e.leases.size > 0 || e.inflight > 0) return true;
    return false;
  }

  openCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.store) n++;
    return n;
  }

  /* ---------------- internals ---------------- */

  private entry(project: PoolProject): Entry {
    let e = this.entries.get(project.id);
    if (!e) {
      e = {
        project, store: null, opening: null, closing: null, inflight: 0,
        writeChain: Promise.resolve(), leases: new Map(), lastUsed: 0, openedAt: 0, releaseTimer: null,
      };
      this.entries.set(project.id, e);
    } else if (e.project.root !== project.root && !e.store) {
      e.project = project; // re-linked root
    }
    return e;
  }

  private async ensureOpen(e: Entry): Promise<GraphStore> {
    if (e.store) return e.store;
    if (!e.opening) {
      e.opening = this.openStore(projectGraphPath(e.project.root))
        .then((s) => {
          e.store = s;
          e.openedAt = Date.now();
          return s;
        })
        .catch((err: unknown) => {
          throw toServiceError(err);
        })
        .finally(() => {
          e.opening = null;
        });
      const opened = await e.opening;
      this.enforceLru(e);
      return opened;
    }
    return e.opening;
  }

  private enforceLru(keep: Entry): void {
    const open = [...this.entries.values()].filter((x) => x.store && !x.closing);
    let excess = open.length - this.opts.maxOpenProjects;
    if (excess <= 0) return;
    open
      .filter((x) => x !== keep && x.inflight === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, excess)
      .forEach((x) => {
        excess--;
        void this.close(x.project.id);
      });
  }

  private pinned(e: Entry): boolean {
    return e.leases.size > 0 || this.isWatched(e.project.id);
  }

  private scheduleRelease(e: Entry, delayMs = this.opts.releaseDelayMs): void {
    if (!e.store || e.inflight > 0 || this.pinned(e)) return;
    if (e.releaseTimer && delayMs <= 0) return; // keep a pending (longer) explorer hold
    this.cancelRelease(e);
    const fire = () => {
      e.releaseTimer = null;
      if (e.inflight === 0 && !this.pinned(e)) void this.close(e.project.id);
    };
    if (delayMs <= 0) fire();
    else e.releaseTimer = setTimeout(fire, delayMs).unref();
  }

  private cancelRelease(e: Entry): void {
    if (e.releaseTimer) clearTimeout(e.releaseTimer);
    e.releaseTimer = null;
  }

  private emitWatchDemand(e: Entry): void {
    const watchLeases = [...e.leases.values()].filter((l) => l.watch);
    this.watchDemandListener({
      project: e.project,
      wanted: watchLeases.length > 0,
      debounceMs: watchLeases[0]?.debounceMs ?? 300,
    });
  }
}
