/**
 * `.flowlens/history/{commits,topology}.json` — atomic writes, tolerant
 * reads. A missing, unreadable, corrupt or old-version file reads as `null`
 * (the caller rebuilds); nothing here throws for bad data.
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HISTORY_COMMITS_FILE, HISTORY_DIR, HISTORY_TOPOLOGY_FILE,
  type HistoryCommitsCache, type HistoryTopology,
} from '../contracts/history.js';
import { parseCommitsCache, parseTopologyCache } from '../contracts/history-schema.js';
import { writeFileAtomicAsync } from '../projects/atomic.js';

export const historyDir = (flowlensDir: string): string => join(flowlensDir, HISTORY_DIR);
export const commitsPath = (flowlensDir: string): string => join(historyDir(flowlensDir), HISTORY_COMMITS_FILE);
export const topologyPath = (flowlensDir: string): string => join(historyDir(flowlensDir), HISTORY_TOPOLOGY_FILE);

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
}

async function writeJson(path: string, doc: unknown): Promise<number> {
  await mkdir(join(path, '..'), { recursive: true });
  const text = JSON.stringify(doc);
  await writeFileAtomicAsync(path, text);
  return Buffer.byteLength(text);
}

export async function readCommitsCache(flowlensDir: string): Promise<HistoryCommitsCache | null> {
  return parseCommitsCache(await readJson(commitsPath(flowlensDir)));
}

export const writeCommitsCache = (flowlensDir: string, doc: HistoryCommitsCache): Promise<number> =>
  writeJson(commitsPath(flowlensDir), doc);

export async function readTopologyCache(flowlensDir: string): Promise<HistoryTopology | null> {
  return parseTopologyCache(await readJson(topologyPath(flowlensDir)));
}

export const writeTopologyCache = (flowlensDir: string, doc: HistoryTopology): Promise<number> =>
  writeJson(topologyPath(flowlensDir), doc);

/** Delete both caches (and stray temp files); returns the file names removed. */
export async function clearHistoryCaches(flowlensDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const [name, path] of [[HISTORY_COMMITS_FILE, commitsPath(flowlensDir)], [HISTORY_TOPOLOGY_FILE, topologyPath(flowlensDir)]] as const) {
    const existed = await readFile(path).then(() => true, () => false);
    await rm(path, { force: true });
    if (existed) removed.push(name);
  }
  await rm(historyDir(flowlensDir), { recursive: true, force: true });
  return removed;
}
