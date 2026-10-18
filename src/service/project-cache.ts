/**
 * Short-lived cache of registry lookups for the RPC hot path. Reading
 * projects.json and stat-ing the root on every graph call costs more than
 * the LevelDB read itself; a 1 s TTL keeps `missing` detection prompt.
 */
import type { ProjectRegistry, ProjectWithStatus } from '../contracts/projects.js';

export class ProjectCache {
  private entries = new Map<string, { value: ProjectWithStatus | null; at: number }>();

  constructor(private readonly registry: ProjectRegistry, private readonly ttlMs = 1000) {}

  async get(id: string): Promise<ProjectWithStatus | null> {
    const hit = this.entries.get(id);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = await this.registry.get(id);
    this.entries.set(id, { value, at: Date.now() });
    return value;
  }

  invalidate(id?: string): void {
    if (id) this.entries.delete(id);
    else this.entries.clear();
  }
}
