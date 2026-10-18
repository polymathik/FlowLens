/**
 * Persisted graph digest at `.flowlens/agent-digest.json`, keyed by a cheap
 * graph revision. A hit lets SessionStart/UserPromptSubmit hooks answer
 * without touching the graph at all.
 *
 * Revision signal (wave 2). The graph service exposes no revision counter
 * (requested from Lane B), so the revision is a stat fingerprint of the
 * LevelDB directory: every write — by `index`, the daemon's watcher, a
 * guard's re-index through `RemoteGraphStore`, or a `--no-daemon` process —
 * appends to LevelDB's log on this machine, so it works through the daemon.
 * It is combined with a *base* fingerprint (architecture.json, manifest.json,
 * file_index.json, config.json) that only a full index or a config change
 * moves.
 *
 * The LevelDB part also moves without any content change (the daemon's
 * background compaction, or the watcher re-applying a file the guard already
 * re-indexed). So on a mismatch with an unchanged base, the digest is
 * *revalidated* against the working tree (see digest-revalidate.ts) instead
 * of being thrown away — that keeps hooks on the fast path while
 * `serve --watch` runs.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hashContent } from '../utils/hash.js';
import { DIGEST_VERSION, type AgentGraphDigest } from './digest.js';
import { unchangedSince } from './digest-revalidate.js';

const DIGEST_FILE = 'agent-digest.json';
/** LevelDB files that change on open/close without any data change. */
const VOLATILE = /^(LOCK|LOG|LOG\.old)$/;
/** Files whose change means "re-derive everything" (full index / config edit). */
const BASE_FILES = ['architecture.json', 'manifest.json', 'file_index.json', 'config.json'];

export interface GraphStamp {
  fingerprint: string;
  base_fingerprint: string;
  /** Epoch ms, taken BEFORE the graph was read. */
  read_at: number;
}

export function digestPath(flowlensDir: string): string {
  return join(flowlensDir, DIGEST_FILE);
}

function statPart(path: string, label: string): string {
  try {
    const s = statSync(path);
    return `${label}:${s.size}:${Math.trunc(s.mtimeMs)}`;
  } catch {
    return `${label}:-`;
  }
}

export function baseFingerprint(flowlensDir: string): string {
  return hashContent(BASE_FILES.map((name) => statPart(join(flowlensDir, name), name)).join('|'));
}

/** Full revision: LevelDB directory + base files. Null when there is no graph. */
export function graphFingerprint(flowlensDir: string): string | null {
  const graphDir = join(flowlensDir, 'graph');
  if (!existsSync(graphDir)) return null;
  try {
    const parts = readdirSync(graphDir)
      .filter((name) => !VOLATILE.test(name))
      .sort()
      .map((name) => statPart(join(graphDir, name), name));
    parts.push(baseFingerprint(flowlensDir));
    return hashContent(parts.join('|'));
  } catch {
    return null;
  }
}

/**
 * Take the stamp a digest will be stored under. Call it AFTER your own graph
 * writes and BEFORE reading the graph: any write that lands while the digest
 * is being computed then makes the stored stamp mismatch (a safe miss).
 */
export function captureStamp(flowlensDir: string): GraphStamp | null {
  const fingerprint = graphFingerprint(flowlensDir);
  if (!fingerprint) return null;
  return { fingerprint, base_fingerprint: baseFingerprint(flowlensDir), read_at: Date.now() };
}

export async function readDigest(flowlensDir: string): Promise<AgentGraphDigest | null> {
  const path = digestPath(flowlensDir);
  if (!existsSync(path)) return null;
  try {
    const digest = JSON.parse(await readFile(path, 'utf-8')) as AgentGraphDigest;
    return digest.version === DIGEST_VERSION ? digest : null;
  } catch {
    return null;
  }
}

/**
 * The cached digest if it still describes the graph: exact revision match,
 * or (same base) no source file changed since it was computed — apart from
 * `patching`, files the caller re-reads from the live graph anyway.
 */
export async function readFreshDigest(flowlensDir: string, patching: string[] = []): Promise<AgentGraphDigest | null> {
  const fingerprint = graphFingerprint(flowlensDir);
  if (!fingerprint) return null;
  const digest = await readDigest(flowlensDir);
  if (!digest) return null;
  if (digest.fingerprint === fingerprint) return digest;
  if (!digest.base_fingerprint || digest.base_fingerprint !== baseFingerprint(flowlensDir)) return null;
  if (!unchangedSince(dirname(flowlensDir), digest, patching)) return null;
  if (patching.length > 0) return digest; // only valid once patched; the caller re-stamps
  const restamped = { ...digest, fingerprint };
  await persist(flowlensDir, restamped);
  return restamped;
}

/** Persist a digest under a stamp captured before its graph read. */
export async function writeDigest(
  flowlensDir: string,
  digest: AgentGraphDigest,
  stamp: GraphStamp | null = captureStamp(flowlensDir),
): Promise<void> {
  if (!stamp) return;
  await persist(flowlensDir, {
    ...digest,
    fingerprint: stamp.fingerprint,
    base_fingerprint: stamp.base_fingerprint,
    read_at: stamp.read_at,
  });
}

async function persist(flowlensDir: string, digest: AgentGraphDigest): Promise<void> {
  const path = digestPath(flowlensDir);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(digest));
    await rename(tmp, path);
  } catch {
    // The cache is an optimisation; never fail a hook because of it.
  }
}
