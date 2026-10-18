import type { Entity } from '../entities.js';
import type { Relation } from '../relations.js';

export type SnapshotIndex = {
  [sha: string]: {
    timestamp: string;
    entity_count: number;
    relation_count: number;
  };
};

export type SnapshotData = {
  sha: string;
  timestamp: string;
  entities: Entity[];
  relations: Relation[];
};

/** Default number of snapshots kept by automatic pruning. */
export const SNAPSHOT_KEEP_COUNT = 20;

/** Outcome of resolving a user-supplied ref (full/short SHA, HEAD~1, branch) to a snapshot. */
export type SnapshotRefResolution =
  | { ok: true; sha: string; snapshot: SnapshotData }
  | { ok: false; code: 'invalid_ref' | 'unknown_ref' | 'ambiguous_ref' | 'no_snapshot'; message: string; suggestions: string[] };

/** Outcome of `ensureSnapshotForHead` (called after `flowlens index`). */
export type EnsureSnapshotResult =
  | { status: 'created'; sha: string; pruned: number }
  | { status: 'exists'; sha: string }
  | { status: 'skipped'; reason: string };
