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
import { relative, resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';
import type { FileWatcher, WatchConfig, WatchEvent } from '../contracts/watch.js';

export class ChokidarFileWatcher implements FileWatcher {
  private watcher: FSWatcher | null = null;
  private handler: ((events: WatchEvent[]) => Promise<void>) | null = null;
  private pending: WatchEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private debounceMs = 300;
  private rootDir = '';
  private readyPromise: Promise<void> = Promise.resolve();

  start(rootDir: string, config: WatchConfig): void {
    if (this.watcher) {
      throw new Error('watcher already started');
    }
    this.rootDir = resolve(rootDir);
    this.debounceMs = config.debounceMs;
    this.watcher = chokidar.watch(this.rootDir, {
      // chokidar v4+ dropped glob support, so match globs ourselves.
      ignored: buildIgnoreMatcher(this.rootDir, config.ignore),
      persistent: true,
      ignoreInitial: true,
      usePolling: config.usePolling ?? false,
      interval: 100,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });
    this.readyPromise = new Promise((resolve) => {
      this.watcher?.once('ready', resolve);
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
    this.readyPromise = Promise.resolve();
  }

  onChanges(callback: (events: WatchEvent[]) => Promise<void>): void {
    this.handler = callback;
  }

  async ready(): Promise<void> {
    await this.readyPromise;
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

/** Directories never worth watching, regardless of user config. */
const ALWAYS_IGNORED_DIRS = ['.git', '.flowlens', 'node_modules'];

/**
 * Build a chokidar `ignored` predicate from glob patterns. Patterns are
 * matched against the path relative to the watched root, so
 * `node_modules/**` and `dist/**` behave as users expect.
 */
export function buildIgnoreMatcher(rootDir: string, patterns: string[]): (path: string) => boolean {
  return (absPath: string) => {
    const rel = relative(rootDir, absPath).split(sep).join('/');
    if (rel === '' || rel.startsWith('..')) return false;
    const segments = rel.split('/');
    if (segments.some((s) => ALWAYS_IGNORED_DIRS.includes(s))) return true;
    return patterns.some(
      (p) => minimatch(rel, p, { dot: true }) || minimatch(`${rel}/`, p, { dot: true }) ||
        (p.endsWith('/**') && minimatch(rel, p.slice(0, -3), { dot: true })),
    );
  };
}
