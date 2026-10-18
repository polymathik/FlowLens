import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphStore } from '../contracts/graph.js';
import type { AgentReindexSummary } from '../contracts/agent.js';
import type { WatchEvent } from '../contracts/watch.js';
import { applyWatchEvents } from '../watch/incremental-updater.js';

export async function reindexAgentChangedFiles(
  rootDir: string,
  graph: GraphStore,
  changedFiles: string[],
): Promise<AgentReindexSummary | undefined> {
  const events = toWatchEvents(rootDir, changedFiles);
  if (events.length === 0) return undefined;
  const result = await applyWatchEvents(events, { rootDir, graph });
  return {
    files_reparsed: result.filesReparsed,
    files_deleted: result.filesDeleted,
    entities_updated: result.entitiesUpdated,
    relations_updated: result.relationsUpdated,
    errors: result.errors,
    duration_ms: result.durationMs,
  };
}

function toWatchEvents(rootDir: string, files: string[]): WatchEvent[] {
  const now = Date.now();
  return [...new Set(files)].map((file) => ({
    type: existsSync(join(rootDir, file)) ? 'change' : 'unlink',
    path: file,
    timestamp: now,
  }));
}
