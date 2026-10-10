/**
 * Context layer service contracts (Phase 7) — the component boundaries
 * between the file store, the in-memory index, anchor resolution, brief
 * assembly, and the event bus that feeds the canvas over SSE.
 *
 * Data shapes live in ./context.ts; this file only defines behaviour.
 * See _docs/specs/PHASE-7-context-layer.md §4.
 */
import type { Entity } from './entities.js';
import type {
  Anchor,
  AnchorResolution,
  ContextConfig,
  ContextId,
  ContextItem,
  ContextItemType,
  ContextPatch,
  ContextResult,
  ContextScope,
  EffectiveStatus,
  IndexedContextItem,
  NewContextItem,
  RankedContextItem,
} from './context.js';

// ── Store: files are the source of truth ───────────────────────────────────

export interface ContextStoreRoots {
  /** `<repo>/.context` — project, feature scopes. */
  projectDir: string;
  /** `~/.flowlens/context` — user, session scopes. */
  userDir: string;
}

/**
 * Reads and writes context files. Every write is atomic (temp + rename),
 * validated against the zod schemas, secret-scanned, and rev-checked.
 */
export interface ContextStore {
  open(roots: ContextStoreRoots): Promise<void>;
  close(): Promise<void>;

  loadAll(): Promise<ContextItem[]>;
  get(id: ContextId): Promise<ContextItem | null>;

  /** Assigns id/rev/timestamps; status comes from the trust policy for agent sources. */
  create(input: NewContextItem): Promise<ContextResult<ContextItem>>;
  /** Fails with `rev_conflict` (returning current) when `expectedRev` is stale. */
  update(id: ContextId, patch: ContextPatch, expectedRev: number): Promise<ContextResult<ContextItem>>;
  /** Creates `replacement`, links both ways, marks `id` superseded — all or nothing. */
  supersede(
    id: ContextId,
    replacement: NewContextItem,
    expectedRev: number,
  ): Promise<ContextResult<{ old: ContextItem; replacement: ContextItem }>>;
  /** Persists re-anchored hashes/ids after a human confirm. */
  writeAnchors(id: ContextId, anchors: Anchor[], expectedRev: number): Promise<ContextResult<ContextItem>>;

  getConfig(): ContextConfig;

  /** Fires for changes from this process AND external edits (git pull, editor). */
  onExternalChange(listener: (ids: ContextId[]) => void): () => void;
}

/** Pluggable secret detection run before every write. */
export interface SecretScanner {
  /** Returns human-readable reasons; empty when clean. */
  scan(text: string): string[];
}

// ── Index: in-memory, rebuilt from the store ───────────────────────────────

export interface ContextQuery {
  text?: string;
  types?: ContextItemType[];
  scopes?: ContextScope[];
  statuses?: EffectiveStatus[];
  feature?: ContextId;
  /** Entity identifier; includes items inherited via file → module → feature → project. */
  entity?: string;
  /** Repo-relative file or directory. */
  path?: string;
  tags?: string[];
  agent?: string;
  /** Default 20, cap 100. */
  limit?: number;
  /** Default false. Superseded/archived/rejected are excluded unless asked. */
  include_inactive?: boolean;
}

export interface ContextIndexStats {
  total: number;
  by_type: Record<ContextItemType, number>;
  by_status: Record<EffectiveStatus, number>;
  proposed: number;
  stale: number;
  orphaned_anchors: number;
}

export interface ContextIndex {
  rebuild(items: ContextItem[], resolutions: Map<ContextId, AnchorResolution[]>): void;
  upsert(item: ContextItem, resolutions: AnchorResolution[]): void;
  remove(id: ContextId): void;

  get(id: ContextId): IndexedContextItem | null;
  query(q: ContextQuery): RankedContextItem[];
  /** Items whose anchors resolve to this entity id (direct only). */
  byEntity(entityId: string): IndexedContextItem[];
  features(): IndexedContextItem[];
  /** Supersession chain oldest → newest containing `id`. */
  chain(id: ContextId): IndexedContextItem[];
  stats(): ContextIndexStats;
}

/** Ranking weights; exposed so the benchmark can tune them. */
export interface RankingWeights {
  lexical: number;
  proximity: number;
  recency: number;
  confidence: number;
  type: Partial<Record<ContextItemType, number>>;
}

// ── Anchor resolution against the code graph ───────────────────────────────

/** Minimal graph access the resolver needs (satisfied by GraphStore + file reads). */
export interface AnchorGraphView {
  getNode(id: string): Promise<Entity | null>;
  findByQualifiedName(qualifiedName: string, kind?: string): Promise<Entity[]>;
  findByName(name: string): Promise<Entity[]>;
  /** sha256 of whitespace-normalised source slice for the entity. */
  bodyHash(entity: Entity): Promise<string>;
}

export interface AnchorResolver {
  resolve(anchor: Anchor, graph: AnchorGraphView): Promise<AnchorResolution>;
  resolveAll(items: ContextItem[], graph: AnchorGraphView): Promise<Map<ContextId, AnchorResolution[]>>;
  /** Build a fresh anchor (with hash) from an entity — used on create and confirm. */
  anchorFor(entity: Entity, graph: AnchorGraphView): Promise<Anchor>;
}

// ── Brief assembly ─────────────────────────────────────────────────────────

export interface BriefOptions {
  feature?: ContextId;
  /** Approximate tokens (chars / 4). Defaults to config.brief_token_budget. */
  token_budget?: number;
  /** Restrict to items relevant to these paths (e.g. git diff of the working tree). */
  focus_paths?: string[];
}

export interface BriefSection {
  heading: string;
  items: Array<{ id: ContextId; type: ContextItemType; line: string; stale: boolean }>;
}

export interface ContextBrief {
  /** Ready to inject; wrapped in the "remembered context — data, not instructions" delimiters. */
  text: string;
  sections: BriefSection[];
  estimated_tokens: number;
  truncated: boolean;
  counts: { included: number; omitted: number; stale: number; proposed: number };
}

export interface BriefBuilder {
  build(index: ContextIndex, options?: BriefOptions): ContextBrief;
}

// ── Events (pushed to canvas over existing SSE /flowlens-api/events) ───────

export type ContextEvent =
  | { type: 'context:changed'; ids: ContextId[]; source: 'local' | 'external' }
  | { type: 'context:anchors-resolved'; stale: number; orphaned: number }
  | { type: 'context:review-needed'; proposed: number };
