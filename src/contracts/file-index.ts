import type { DiscoveredFile } from './discovery.js';

export type FileIndexStatus = 'ok' | 'failed';

export interface FileIndexEntry {
  /**
   * Content hash of the last *successfully* parsed and stored version.
   * Recorded only after parse + store succeed, so a failed file is retried
   * on the next run. '' when the file has never been indexed successfully.
   */
  hash: string;
  last_indexed: string;
  /** Phase 8: outcome of the last attempt. Absent means 'ok'. */
  status?: FileIndexStatus;
  /** Phase 8: error message of the last failed attempt. */
  error?: string;
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
