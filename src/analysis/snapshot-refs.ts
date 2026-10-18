/**
 * Resolve a user-supplied ref (full SHA, short SHA, HEAD~1, branch, tag) to
 * a stored snapshot. Order: exact snapshot key -> unique hex prefix of a
 * stored snapshot -> `git rev-parse` of the ref -> snapshot for that SHA.
 */

import type { SnapshotRefResolution } from '../contracts/analysis/snapshots.js';
import { SnapshotManager } from './snapshot-manager.js';
import { revParseCommit } from './git.js';

/** Characters allowed in git refs/revision expressions we accept. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,199}$/;

export async function resolveSnapshotRef(
  ref: string,
  snapshots: SnapshotManager,
  rootDir: string,
): Promise<SnapshotRefResolution> {
  const trimmed = ref.trim();
  if (!REF_PATTERN.test(trimmed) || trimmed.includes('..')) {
    return {
      ok: false,
      code: 'invalid_ref',
      message: `Invalid snapshot ref: '${ref}'`,
      suggestions: ['Pass a commit SHA (full or short), HEAD, HEAD~1, a tag or a branch name'],
    };
  }

  const index = await snapshots.listSnapshots();
  const keys = Object.keys(index);

  // 1. Exact stored key (also covers non-SHA keys used in tests/tools).
  if (snapshots.hasSnapshot(trimmed)) return load(trimmed, snapshots);

  // 2. Unique hex prefix of a stored snapshot.
  if (/^[0-9a-f]{4,63}$/i.test(trimmed)) {
    const matches = keys.filter((k) => k.toLowerCase().startsWith(trimmed.toLowerCase()));
    if (matches.length === 1) return load(matches[0], snapshots);
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'ambiguous_ref',
        message: `Ref '${ref}' matches ${matches.length} snapshots`,
        suggestions: matches.slice(0, 10),
      };
    }
  }

  // 3. Ask git (HEAD~1, branch, tag, short SHA without a stored match).
  const sha = revParseCommit(trimmed, rootDir);
  if (!sha) {
    return {
      ok: false,
      code: 'unknown_ref',
      message: `Unknown ref '${ref}': not a stored snapshot and git cannot resolve it`,
      suggestions: availableSuggestions(index),
    };
  }
  if (snapshots.hasSnapshot(sha)) return load(sha, snapshots);

  return {
    ok: false,
    code: 'no_snapshot',
    message: `No snapshot for '${ref}' (${sha.slice(0, 12)})`,
    suggestions: [
      `Snapshots are taken by "flowlens index"/"flowlens init" at each commit, or on demand: check out ${sha.slice(0, 12)} and run "flowlens snapshot"`,
      ...availableSuggestions(index),
    ],
  };
}

async function load(sha: string, snapshots: SnapshotManager): Promise<SnapshotRefResolution> {
  const snapshot = await snapshots.loadSnapshot(sha);
  if (!snapshot) {
    return { ok: false, code: 'no_snapshot', message: `Snapshot file for ${sha} is missing or unreadable`, suggestions: [] };
  }
  return { ok: true, sha, snapshot };
}

function availableSuggestions(index: Record<string, { timestamp: string }>): string[] {
  const recent = Object.entries(index)
    .sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp))
    .slice(0, 5)
    .map(([sha, info]) => `available: ${sha.slice(0, 12)} (${info.timestamp})`);
  return recent.length > 0 ? recent : ['No snapshots stored yet — run "flowlens snapshot" to create one'];
}
