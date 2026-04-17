/**
 * chokidar-backed FileWatcher.
 *
 * Debouncing: events within `debounceMs` of each other are batched into
 * a single flush. The timer is reset on every new event, so a burst of
 * saves from a formatter settles into one re-index instead of N.
 *
 * `awaitWriteFinish` handles editors that write files in multiple passes
 * (save-as, atomic rename). chokidar waits until the file's size is
 * stable before emitting, which prevents partial-file parse errors.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import { relative, resolve } from 'node:path';
import type { FileWatcher, WatchConfig, WatchEvent } from '../contracts/watch.js';

export class ChokidarFileWatcher implements FileWatcher {
  private watcher: FSWatcher | null = null;
  private handler: ((events: WatchEvent[]) => Promise<void>) | null = null;
  private pending: WatchEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private debounceMs = 300;
  private rootDir = '';

  start(rootDir: string, config: WatchConfig): void {
    if (this.watcher) {
      throw new Error('watcher already started');
    }
    this.rootDir = resolve(rootDir);
    this.debounceMs = config.debounceMs;
    this.watcher = chokidar.watch(this.rootDir, {
      ignored: config.ignore,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (path) => this.enqueue('add', path));
    this.watcher.on('change', (path) => this.enqueue('change', path));
    this.watcher.on('unlink', (path) => this.enqueue('unlink', path));
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.pending = [];
    this.handler = null;
  }

  onChanges(callback: (events: WatchEvent[]) => Promise<void>): void {
    this.handler = callback;
  }

  private enqueue(type: WatchEvent['type'], abs: string): void {
    const rel = relative(this.rootDir, abs);
    this.pending.push({ type, path: rel, timestamp: Date.now() });
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0 || !this.handler) return;
    try {
      await this.handler(batch);
    } catch {
      // Handler errors should not tear down the watcher. They're the
      // caller's responsibility — we just keep listening.
    }
  }
}
