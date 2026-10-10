/**
 * MCP tool contracts for the context layer (Phase 7).
 *
 * Inputs take entity identifiers (qualified name, id or path) for anchors;
 * the tool layer resolves them via mcp/entity-resolver before calling the
 * store. Every output carries a `canvas_url` deep link.
 *
 * See _docs/specs/PHASE-7-context-layer.md §5.
 */
import type {
  ContextId,
  ContextItemType,
  ContextScope,
  EffectiveStatus,
  FeatureFields,
  IndexedContextItem,
  PersistedStatus,
  RankedContextItem,
} from '../context.js';
import type { ContextBrief, ContextIndexStats } from '../context-services.js';

/** Fields shared by add and supersede. */
export interface ContextItemInput {
  type: ContextItemType;
  title: string;
  body: string;
  /** Defaults by type (see spec §3.1). */
  scope?: ContextScope;
  /** Entity identifiers to anchor to. */
  anchors?: string[];
  feature?: ContextId;
  tags?: string[];
  confidence?: number;
  related?: ContextId[];
  /** Only for type 'feature'. */
  feature_fields?: Partial<FeatureFields>;
}

interface WithCanvasUrl {
  canvas_url: string;
}

// context_add
export interface ContextAddInput {
  items: ContextItemInput[];
  /** Agent name and session id for provenance. */
  agent?: string;
  session?: string;
}
export interface ContextAddOutput {
  created: Array<{ id: ContextId; status: PersistedStatus } & WithCanvasUrl>;
  /** Per-item failures (validation, secret, unresolved anchor) — others still succeed. */
  failed: Array<{ index: number; code: string; message: string; suggestions?: string[] }>;
}

// context_update
export interface ContextUpdateInput {
  id: ContextId;
  rev: number;
  title?: string;
  body?: string;
  add_anchors?: string[];
  remove_anchors?: string[];
  tags?: string[];
  status?: Extract<PersistedStatus, 'active' | 'archived'>;
  confirm?: boolean;
}
export interface ContextUpdateOutput extends WithCanvasUrl {
  item: IndexedContextItem;
}

// context_supersede
export interface ContextSupersedeInput {
  id: ContextId;
  rev: number;
  replacement: ContextItemInput;
  /** One line: why the old item no longer holds. Appended to the replacement body. */
  reason: string;
}
export interface ContextSupersedeOutput extends WithCanvasUrl {
  old_id: ContextId;
  new_id: ContextId;
}

// context_query
export interface ContextQueryInput {
  text?: string;
  types?: ContextItemType[];
  scopes?: ContextScope[];
  statuses?: EffectiveStatus[];
  feature?: ContextId;
  entity?: string;
  path?: string;
  tags?: string[];
  include_inactive?: boolean;
  max_results?: number;
}
export interface ContextQueryOutput {
  results: RankedContextItem[];
  total_matched: number;
}

// context_brief
export interface ContextBriefInput {
  feature?: ContextId;
  token_budget?: number;
  focus_paths?: string[];
}
export type ContextBriefOutput = ContextBrief & WithCanvasUrl;

// context_review
export interface ContextReviewInput {
  kind?: 'proposed' | 'stale' | 'all';
  max_results?: number;
}
export interface ContextReviewOutput extends WithCanvasUrl {
  items: IndexedContextItem[];
  stats: ContextIndexStats;
}

/**
 * get_context enrichment: existing GetContextResult gains this field.
 * Ranked anchored + inherited items, capped by `max_context` (default 10).
 */
export interface GetContextContextExtension {
  context: RankedContextItem[];
}

/** Legacy annotate category → context type mapping (alias tool). */
export const ANNOTATION_CATEGORY_TO_TYPE = {
  convention: 'convention',
  decision: 'decision',
  warning: 'gotcha',
  todo: 'open_question',
} as const satisfies Record<string, ContextItemType>;
