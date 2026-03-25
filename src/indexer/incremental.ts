import type { FileIndexEntry } from '../contracts/file-index.js';
import type { DiscoveredFile } from '../contracts/discovery.js';

export function buildUpdatedIndex(
  previousIndex: Record<string, FileIndexEntry>,
  processedFiles: DiscoveredFile[],
  fileHashes: Map<string, string>,
  deletedPaths: string[],
): Record<string, FileIndexEntry> {
  const newIndex: Record<string, FileIndexEntry> = { ...previousIndex };

  // Remove deleted files
  for (const path of deletedPaths) {
    delete newIndex[path];
  }

  // Update/add processed files
  const now = new Date().toISOString();
  for (const file of processedFiles) {
    const hash = fileHashes.get(file.path);
    if (hash) {
      newIndex[file.path] = { hash, last_indexed: now };
    }
  }

  return newIndex;
}
