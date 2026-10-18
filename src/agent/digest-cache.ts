/**
 * Persisted graph digest at `.flowlens/agent-digest.json`, keyed by a cheap
 * fingerprint of the LevelDB files (+ architecture.json). A hit lets
 * SessionStart/UserPromptSubmit hooks answer without opening the graph at all
 * (fast, and works while another process holds the LevelDB lock).
 *
 * Wave 2: with the graph service, the fingerprint can become the service's
 * graph revision; only `graphFingerprint` changes.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashContent } from '../utils/hash.js';
import { DIGEST_VERSION, type AgentGraphDigest } from './digest.js';

const DIGEST_FILE = 'agent-digest.json';
/** LevelDB files that change on open/close without any data change. */
const VOLATILE = /^(LOCK|LOG|LOG\.old)$/;

export function digestPath(flowlensDir: string): string {
  return join(flowlensDir, DIGEST_FILE);
}

export function graphFingerprint(flowlensDir: string): string | null {
  const graphDir = join(flowlensDir, 'graph');
  if (!existsSync(graphDir)) return null;
  try {
    const parts = readdirSync(graphDir)
      .filter((name) => !VOLATILE.test(name))
      .sort()
      .map((name) => {
        const stat = statSync(join(graphDir, name));
        return `${name}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      });
    const arch = join(flowlensDir, 'architecture.json');
    if (existsSync(arch)) {
      const stat = statSync(arch);
      parts.push(`arch:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
    }
    return hashContent(parts.join('|'));
  } catch {
    return null;
  }
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

/** Returns the cached digest only if it matches the current graph fingerprint. */
export async function readFreshDigest(flowlensDir: string): Promise<AgentGraphDigest | null> {
  const fingerprint = graphFingerprint(flowlensDir);
  if (!fingerprint) return null;
  const digest = await readDigest(flowlensDir);
  return digest && digest.fingerprint === fingerprint ? digest : null;
}

/**
 * Persist a digest. Must be called AFTER the graph is closed so the
 * fingerprint reflects the on-disk state the digest was computed from.
 */
export async function writeDigest(flowlensDir: string, digest: AgentGraphDigest): Promise<void> {
  const fingerprint = graphFingerprint(flowlensDir);
  if (!fingerprint) return;
  const path = digestPath(flowlensDir);
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify({ ...digest, fingerprint }));
    await rename(tmp, path);
  } catch {
    // The cache is an optimisation; never fail a hook because of it.
  }
}
