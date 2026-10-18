import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hashFile as computeHash } from '../utils/hash.js';
import type { FileIndexEntry, FileIndex } from '../contracts/file-index.js';
import type { DiscoveredFile } from '../contracts/discovery.js';
import { writeFileAtomicAsync } from '../projects/atomic.js';

export class FileIndexManager implements FileIndex {
  async load(indexPath: string): Promise<Record<string, FileIndexEntry>> {
    if (!existsSync(indexPath)) return {};
    const content = await readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  }

  /** Atomic (tmp + fsync + rename): a crash or a concurrent reader never sees a torn file. */
  async save(indexPath: string, index: Record<string, FileIndexEntry>): Promise<void> {
    await writeFileAtomicAsync(indexPath, JSON.stringify(index, null, 2));
  }

  async hashFile(filePath: string): Promise<string> {
    return computeHash(filePath);
  }

  async getChangedFiles(
    discovered: DiscoveredFile[],
    currentIndex: Record<string, FileIndexEntry>,
  ): Promise<{ changed: DiscoveredFile[]; deleted: string[] }> {
    const discoveredPaths = new Set(discovered.map(f => f.path));

    // Files in index but not in discovered = deleted
    const deleted = Object.keys(currentIndex).filter(p => !discoveredPaths.has(p));

    // Files not in index or with different hash = changed
    const changed: DiscoveredFile[] = [];
    for (const file of discovered) {
      const entry = currentIndex[file.path];
      if (!entry) {
        changed.push(file);
        continue;
      }
      const hash = await this.hashFile(file.absolutePath);
      if (hash !== entry.hash) {
        changed.push(file);
      }
    }

    return { changed, deleted };
  }
}
