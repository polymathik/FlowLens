/**
 * Per-project HealthReport cache for the explorer. A report is reused while
 * its fingerprint is unchanged:
 *
 *   daemon graph revision (bumps on every write through the daemon)
 *   + manifest `finished_at` (catches `index --no-daemon`)
 *   + architecture.json mtime (rules change violations)
 *
 * and for at most `ttlMs` (git history, i.e. "changes often", moves on its
 * own). Concurrent requests for the same fingerprint share one computation.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { HealthReport } from '../contracts/health.js';
import { readManifest } from '../projects/manifest-sync.js';

const DEFAULT_TTL_MS = 5 * 60_000;

interface Entry {
  key: string;
  at: number;
  report: Promise<HealthReport>;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function healthFingerprint(root: string, revision: number): string {
  const manifest = readManifest(root);
  return [revision, manifest?.finished_at ?? '-', mtime(join(root, '.flowlens', 'architecture.json'))].join('|');
}

export class HealthCache {
  private entries = new Map<string, Entry>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS, private readonly now: () => number = Date.now) {}

  async get(
    projectId: string,
    key: string,
    compute: () => Promise<HealthReport>,
  ): Promise<{ report: HealthReport; cached: boolean }> {
    const hit = this.entries.get(projectId);
    if (hit && hit.key === key && this.now() - hit.at < this.ttlMs) {
      return { report: await hit.report, cached: true };
    }
    const entry: Entry = { key, at: this.now(), report: compute() };
    this.entries.set(projectId, entry);
    try {
      return { report: await entry.report, cached: false };
    } catch (err) {
      if (this.entries.get(projectId) === entry) this.entries.delete(projectId);
      throw err;
    }
  }

  delete(projectId: string): void {
    this.entries.delete(projectId);
  }
}
