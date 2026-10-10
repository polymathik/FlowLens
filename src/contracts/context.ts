/**
 * Context layer contract (Phase 7) — the data model for durable project
 * knowledge: decisions, conventions, gotchas, features, handoffs, etc.
 *
 * Items are persisted as markdown files with YAML frontmatter under
 * `.context/items/<type>/` (project/feature scope) or
 * `~/.flowlens/context/items/<type>/` (user/session scope). The files are the
 * source of truth; everything in `.flowlens/` is a rebuildable index.
 *
 * The zod schemas below validate frontmatter on read and every write that
 * crosses a boundary (MCP, REST, CLI). Types are inferred from the schemas so
 * the two can never drift.
 *
 * See _docs/specs/PHASE-7-context-layer.md §3.
 */
import { z } from 'zod';
import type { EntityKind } from './entities.js';

// ── Enumerations ────────────────────────────────────────────────────────────

export const CONTEXT_ITEM_TYPES = [
  'decision',
  'rejected_alternative',
  'convention',
  'constraint',
  'gotcha',
  'command',
  'open_question',
  'feature',
  'handoff',
  'preference',
  'note',
] as const;
export const ContextItemTypeSchema = z.enum(CONTEXT_ITEM_TYPES);
export type ContextItemType = z.infer<typeof ContextItemTypeSchema>;

/** Narrowest scope first is NOT the order; this is inheritance order, widest first. */
export const CONTEXT_SCOPES = ['user', 'project', 'feature', 'session'] as const;
export const ContextScopeSchema = z.enum(CONTEXT_SCOPES);
export type ContextScope = z.infer<typeof ContextScopeSchema>;

/**
 * Persisted status. `stale` is NOT persisted — it is derived from anchor
 * resolution and exposed as `EffectiveStatus` on indexed items, so files only
 * change on intent and git diffs stay meaningful.
 */
export const PERSISTED_STATUSES = ['proposed', 'active', 'superseded', 'archived', 'rejected'] as const;
export const PersistedStatusSchema = z.enum(PERSISTED_STATUSES);
export type PersistedStatus = z.infer<typeof PersistedStatusSchema>;
export type EffectiveStatus = PersistedStatus | 'stale';

// ── Identifiers ─────────────────────────────────────────────────────────────

/** `ctx_` + 8 lowercase hex chars. */
export const ContextIdSchema = z.string().regex(/^ctx_[0-9a-f]{8}$/);
export type ContextId = z.infer<typeof ContextIdSchema>;

// ── Anchors ─────────────────────────────────────────────────────────────────

/**
 * A pointer from an item into the code graph. Stores enough to re-find the
 * entity after renames/moves (qualified_name + kind) and to detect drift
 * (body_hash). `entity_id` is a fast-path cache, not the identity.
 */
export const AnchorSchema = z.object({
  qualified_name: z.string().min(1),
  file: z.string().min(1),
  kind: z.string().min(1) as z.ZodType<EntityKind | 'module' | 'file'>,
  entity_id: z.string().optional(),
  /** sha256 of whitespace-normalised source slice; absent for file/module anchors. */
  body_hash: z.string().optional(),
  line_hint: z.number().int().nonnegative().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export type AnchorState = 'attached' | 'drifted' | 'moved' | 'orphaned';

/** Result of re-resolving one anchor against the current code graph. */
export interface AnchorResolution {
  anchor: Anchor;
  state: AnchorState;
  /** Present for attached / drifted / moved. */
  current_entity_id?: string;
  current_file?: string;
  current_body_hash?: string;
  /** Up to 3 candidate entity ids when orphaned. */
  suggestions?: string[];
}

// ── Provenance ──────────────────────────────────────────────────────────────

export const ProvenanceSchema = z.object({
  source: z.enum(['human', 'agent', 'migration', 'scan']),
  /** e.g. 'claude-code', 'codex', 'cursor', 'canvas', 'cli'. */
  agent: z.string().optional(),
  session: z.string().optional(),
  origin: z.enum(['conversation', 'file_scan', 'canvas', 'cli', 'annotation_migration']).optional(),
  /** Files the knowledge was derived from, repo-relative. */
  derived_from: z.array(z.string()).optional(),
  author: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ── Item ────────────────────────────────────────────────────────────────────

const IsoDate = z.string().datetime({ offset: true });

/** Frontmatter + body of one context file. */
export const ContextItemSchema = z.object({
  id: ContextIdSchema,
  type: ContextItemTypeSchema,
  scope: ContextScopeSchema,
  title: z.string().min(1).max(160),
  /** Markdown, stored after the frontmatter. */
  body: z.string().max(8000),
  status: PersistedStatusSchema,
  anchors: z.array(AnchorSchema).default([]),
  /** Owning feature item id (an item of type `feature`). */
  feature: ContextIdSchema.nullable().default(null),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
  supersedes: ContextIdSchema.nullable().default(null),
  superseded_by: ContextIdSchema.nullable().default(null),
  related: z.array(ContextIdSchema).default([]),
  provenance: ProvenanceSchema,
  /** Monotonic revision for optimistic concurrency. Starts at 1. */
  rev: z.number().int().positive(),
  created_at: IsoDate,
  updated_at: IsoDate,
  last_confirmed_at: IsoDate.nullable().default(null),
  /** Mainly for `handoff`; expired items are treated as archived. */
  expires_at: IsoDate.nullable().default(null),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

/** Extra fields for items of type `feature`. Stored in frontmatter. */
export const FeatureFieldsSchema = z.object({
  feature_status: z.enum(['planned', 'in_progress', 'done', 'paused']).default('in_progress'),
  /** Globs over repo-relative paths that belong to the feature (drives canvas hulls). */
  members: z.array(z.string()).default([]),
});
export type FeatureFields = z.infer<typeof FeatureFieldsSchema>;

// ── Write inputs ────────────────────────────────────────────────────────────

/**
 * What callers supply to create an item. The store assigns id, rev,
 * timestamps and status (per trust policy). Anchors may be given as entity
 * identifiers (qualified name, id or path) and are resolved by the caller
 * layer before reaching the store.
 */
export const NewContextItemSchema = ContextItemSchema.pick({
  type: true,
  scope: true,
  title: true,
  body: true,
  anchors: true,
  feature: true,
  tags: true,
  confidence: true,
  related: true,
  provenance: true,
  expires_at: true,
}).partial({ anchors: true, feature: true, tags: true, confidence: true, related: true, expires_at: true })
  .extend({ feature_fields: FeatureFieldsSchema.optional() });
export type NewContextItem = z.infer<typeof NewContextItemSchema>;

export const ContextPatchSchema = NewContextItemSchema.omit({ provenance: true, type: true })
  .partial()
  .extend({
    status: PersistedStatusSchema.optional(),
    /** Marks the item as re-verified now; also clears drift by refreshing anchor hashes. */
    confirm: z.boolean().optional(),
  });
export type ContextPatch = z.infer<typeof ContextPatchSchema>;

// ── Trust policy / config (.context/config.json) ───────────────────────────

export const ContextConfigSchema = z.object({
  version: z.literal(1),
  /** Agent writes of these types skip the Inbox. */
  auto_accept_types: z.array(ContextItemTypeSchema).default(['command', 'handoff']),
  /** Max agent-proposed items per session before writes are refused. */
  max_proposed_per_session: z.number().int().positive().default(25),
  /** Default token budget for context_brief / `flowlens brief`. */
  brief_token_budget: z.number().int().positive().default(1500),
  /** Days before a handoff expires. */
  handoff_ttl_days: z.number().int().positive().default(14),
  /** Repo-relative globs from which `file_scan` provenance is refused (vendored code). */
  untrusted_paths: z.array(z.string()).default(['node_modules/**', 'vendor/**', 'third_party/**']),
});
export type ContextConfig = z.infer<typeof ContextConfigSchema>;

// ── Indexed / ranked views ─────────────────────────────────────────────────

/** An item as served by the index: persisted fields plus derived state. */
export interface IndexedContextItem extends ContextItem {
  effective_status: EffectiveStatus;
  anchor_resolutions: AnchorResolution[];
  /** Absolute path of the backing file. */
  file_path: string;
  feature_fields?: FeatureFields;
}

/** Why an item was included in a result for a given entity. */
export type ContextInheritance =
  | { via: 'anchor'; entity_id: string }
  | { via: 'file'; file: string }
  | { via: 'module'; module: string }
  | { via: 'feature'; feature: ContextId }
  | { via: 'scope'; scope: 'project' | 'user' }
  | { via: 'search' };

export interface RankedContextItem {
  item: IndexedContextItem;
  score: number;
  inheritance: ContextInheritance;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type ContextErrorCode =
  | 'not_found'
  | 'rev_conflict'
  | 'validation_failed'
  | 'secret_detected'
  | 'rate_limited'
  | 'untrusted_source'
  | 'anchor_unresolved'
  | 'io_error';

export interface ContextError {
  code: ContextErrorCode;
  message: string;
  /** For rev_conflict: the current item so the caller can merge. */
  current?: IndexedContextItem;
  /** For anchor_unresolved: candidate entity names. */
  suggestions?: string[];
}

export type ContextResult<T> = { ok: true; value: T } | { ok: false; error: ContextError };
