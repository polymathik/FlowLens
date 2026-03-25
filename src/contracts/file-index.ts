import type { DiscoveredFile } from './discovery.js';

export interface FileIndexEntry {
  hash: string;
  last_indexed: string;
}

export interface FileIndex {
  load(indexPath: string): Promise<Record<string, FileIndexEntry>>;
  save(indexPath: string, index: Record<string, FileIndexEntry>): Promise<void>;
  hashFile(filePath: string): Promise<string>;
  getChangedFiles(
    discovered: DiscoveredFile[],
    currentIndex: Record<string, FileIndexEntry>
  ): Promise<{ changed: DiscoveredFile[]; deleted: string[] }>;
}
