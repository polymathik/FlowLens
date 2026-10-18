/**
 * Per-project file watchers inside the daemon. A watcher runs while at
 * least one lease asks for it (`LeaseRequest.watch`). Each batch of file
 * events is applied with the shared incremental updater through the pool's
 * per-project write queue, then broadcast as a `graph-changed` SSE event.
 */
import type { FileWatcher } from '../contracts/watch.js';
import { loadProjectExcludes } from '../projects/config.js';
import { ChokidarFileWatcher } from '../watch/file-watcher.js';
import { applyWatchEvents } from '../watch/incremental-updater.js';
import type { EventHub } from './events.js';
import type { GraphPool, PoolProject, WatchDemand } from './graph-pool.js';

export type WatcherFactory = () => FileWatcher;
export type Logger = (msg: string) => void;

export class WatcherManager {
  private watchers = new Map<string, FileWatcher>();
  private pool: GraphPool | null = null;

  constructor(
    private readonly hub: EventHub,
    private readonly log: Logger,
    private readonly factory: WatcherFactory = () => new ChokidarFileWatcher(),
  ) {}

  attach(pool: GraphPool): void {
    this.pool = pool;
    pool.onWatchDemand((d) => void this.onDemand(d));
  }

  isWatching(id: string): boolean {
    return this.watchers.has(id);
  }

  async start(project: PoolProject, debounceMs: number): Promise<void> {
    if (this.watchers.has(project.id)) return;
    const watcher = this.factory();
    this.watchers.set(project.id, watcher);
    watcher.onChanges(async (events) => {
      if (!this.pool) return;
      const result = await this.pool.use(project, true, (graph) =>
        applyWatchEvents(events, { rootDir: project.root, graph }),
      );
      const paths = [...new Set(events.map((e) => e.path))].slice(0, 50);
      this.hub.broadcast(project.id, {
        type: 'graph-changed',
        project_id: project.id,
        source: 'watch',
        files_reparsed: result.filesReparsed,
        files_deleted: result.filesDeleted,
        paths,
        errors: result.errors,
        duration_ms: result.durationMs,
        at: new Date().toISOString(),
      });
      this.log(`[watch] ${project.id}: ${result.filesReparsed} reparsed / ${result.filesDeleted} deleted in ${result.durationMs}ms`);
    });
    watcher.start(project.root, { debounceMs, ignore: loadProjectExcludes(project.root) });
    await watcher.ready();
    this.log(`[watch] started ${project.id} (${project.root})`);
  }

  async stop(id: string): Promise<void> {
    const w = this.watchers.get(id);
    if (!w) return;
    this.watchers.delete(id);
    await w.stop();
    this.log(`[watch] stopped ${id}`);
    this.pool?.recheck(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.stop(id)));
  }

  private async onDemand(d: WatchDemand): Promise<void> {
    try {
      if (d.wanted) await this.start(d.project, d.debounceMs);
      else await this.stop(d.project.id);
    } catch (err) {
      this.log(`[watch] ${d.project.id}: ${(err as Error).message}`);
    }
  }
}
