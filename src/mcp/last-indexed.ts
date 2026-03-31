import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Read the latest `last_indexed` timestamp from file_index.json.
 * Returns empty string if file doesn't exist.
 */
export async function getLastIndexed(fileIndexPath: string): Promise<string> {
  if (!existsSync(fileIndexPath)) return '';
  const content = await readFile(fileIndexPath, 'utf-8');
  const index = JSON.parse(content) as Record<string, { last_indexed: string }>;
  let latest = '';
  for (const entry of Object.values(index)) {
    if (entry.last_indexed > latest) latest = entry.last_indexed;
  }
  return latest;
}
