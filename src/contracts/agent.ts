import type { EntityKind, Location } from './entities.js';
import type { RelationType } from './relations.js';
import type { CycleGranularity, CycleSeverity } from './analysis/cycles.js';
import type { HealthConfidence, HealthGrade } from './health.js';

export type AgentEvent =
  | 'session_start'
  | 'prompt_submit'
  | 'pre_edit'
  | 'post_edit'
  | 'pre_commit'
  | 'stop'
  | 'compact';

export type AgentOutputFormat = 'markdown' | 'json';
export type AgentRisk = 'none' | 'low' | 'medium' | 'high';
export type AgentProvider = 'claude-code';
export type AgentChangedSource = 'argument' | 'hook' | 'git' | 'none';

export interface AgentContextRequest {
  event: AgentEvent;
  prompt?: string;
  changed_files?: string[];
  max_items?: number;
  /** Phase 23: name the FlowLens MCP tools in the guidance (set unless the MCP server is known to be missing). */
  tools_hint?: boolean;
  /** Phase 23: the PreToolUse edit gate is installed (the guidance says edits to protected files are held). */
  gate?: boolean;
  /** Phase 23: the agent receiving the guidance (the ToolSearch hint is Claude Code only). */
  agent?: 'claude-code' | 'codex';
}

export interface AgentEntityReference {
  id: string;
  kind: EntityKind;
  name: string;
  qualified_name: string;
  file: string;
  location: Location;
  language: string;
  quality_score?: number;
  hotspot_score?: number;
  reason?: string;
}

export interface AgentCycleReference {
  id: string;
  granularity: CycleGranularity;
  severity: CycleSeverity;
  entities: string[];
  relation_types: RelationType[];
  length: number;
}

export interface AgentViolationReference {
  id: string;
  rule: 'may_only_access' | 'must_not_access';
  layer_from: string;
  layer_to: string;
  entity_from: string;
  entity_to: string;
  relation_type: RelationType;
  file: string;
  line: number;
  suggestion: string;
}

export interface AgentImpactReference {
  entity: AgentEntityReference;
  inbound_count: number;
  outbound_count: number;
}

export interface AgentContextPacket {
  generated_at: string;
  event: AgentEvent;
  summary: {
    entity_count: number;
    relation_count: number;
    languages: Record<string, number>;
  };
  relevant_files: string[];
  relevant_entities: AgentEntityReference[];
  hotspots: AgentEntityReference[];
  cycles: AgentCycleReference[];
  architecture_violations: AgentViolationReference[];
  guidance: string[];
  /** Where graph-wide facts came from: the persisted digest cache or a fresh scan. */
  digest?: { source: 'cache' | 'fresh' | 'stale-cache'; computed_at: string };
  warnings?: string[];
  /** SessionStart only: 3-line plain-English health headline (wave 2). */
  health?: AgentHealthHeadline;
}

/**
 * Compact health signal for agent context, derived from the Phase 11
 * `HealthSummary` (src/health). Full report: MCP `flowlens://health` or
 * `flowlens report`.
 */
export interface AgentHealthHeadline {
  grade: HealthGrade;
  score: number;
  confidence: HealthConfidence;
  /** Title of the highest-ranked actionable finding, or null when none. */
  top_risk: string | null;
  findings: number;
  critical_or_high: number;
}

/**
 * How agent commands reach the graph (wave 2). Default: through the FlowLens
 * daemon (works while `serve --watch` runs); `daemon: false` (`--no-daemon`)
 * opens LevelDB directly and can then report `busy`.
 */
export interface AgentGraphOptions {
  daemon?: boolean;
}

export interface AgentGuardRequest {
  changed_files: string[];
  changed_source?: AgentChangedSource;
  strict?: boolean;
  max_items?: number;
  /** Result of the incremental re-index run before analysis, if any. */
  reindex?: AgentReindexSummary;
  /**
   * Pre-existing cycles/violations. When present, only issues absent from the
   * baseline count as "new" (and drive `risk: high` / strict blocking).
   */
  baseline?: AgentBaseline;
}

export interface AgentReindexSummary {
  files_reparsed: number;
  files_deleted: number;
  entities_updated: number;
  relations_updated: number;
  errors: Array<{ path: string; message: string }>;
  duration_ms: number;
}

export interface AgentGuardReport {
  generated_at: string;
  changed_files: string[];
  changed_source: AgentChangedSource;
  risk: AgentRisk;
  reindex?: AgentReindexSummary;
  /** Cycles touching changed files that are NOT in the baseline (all of them when no baseline). */
  cycles: AgentCycleReference[];
  /** Violations touching changed files that are NOT in the baseline (all of them when no baseline). */
  architecture_violations: AgentViolationReference[];
  impacted_entities: AgentImpactReference[];
  guidance: string[];
  /** Cycles touching changed files that already existed in the baseline (context only). */
  preexisting_cycles?: AgentCycleReference[];
  /** Violations touching changed files that already existed in the baseline (context only). */
  preexisting_violations?: AgentViolationReference[];
  /** How issues were attributed: against a baseline, or unattributed (no baseline). */
  attribution?: { mode: 'baseline' | 'none'; git_head?: string | null; created_at?: string };
  /** Analysis steps that failed (e.g. cycle detection) — the report is partial. */
  warnings?: string[];
}

/* ---------- Baseline (strict-mode attribution) ---------- */

/**
 * Snapshot of graph issues at a known point (SessionStart or the first guard
 * run before re-indexing), stored in `.flowlens/agent-baseline.json` keyed by
 * git HEAD. Wave 2 may replace the source with the graph manifest/snapshots.
 */
export interface AgentBaseline {
  git_head: string | null;
  created_at: string;
  /** `snapshot`: derived from the graph snapshot for HEAD (wave 2). */
  source: 'session_start' | 'guard' | 'manual' | 'snapshot';
  /** Sorted file lists of every file-level cycle (cycle identity). */
  cycles: string[][];
  /** Violation ids (`violation:<from>:<to>:<rule>` hash). */
  violation_ids: string[];
}

export interface AgentBaselineFile {
  version: 1;
  /** Keyed by git HEAD SHA (or `no-git`). Most recent few are kept. */
  baselines: Record<string, AgentBaseline>;
}

/* ---------- Graph access (single swap point for the graph service) ---------- */

export type AgentGraphUnavailableReason = 'missing' | 'busy' | 'error';

export interface AgentGraphUnavailable {
  ok: false;
  reason: AgentGraphUnavailableReason;
  message: string;
}

/* ---------- Claude Code hook protocol ---------- */

/** Hook stdin JSON (https://code.claude.com/docs/en/hooks#common-input-fields). */
export interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  /** SessionStart: startup | resume | clear | compact | fork */
  source?: string;
  /** UserPromptSubmit */
  prompt?: string;
  /** PostToolUse */
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    filePath?: string;
    notebook_path?: string;
    edits?: Array<{ file_path?: string; filePath?: string }>;
    [key: string]: unknown;
  };
  tool_response?: {
    filePath?: string;
    file_path?: string;
    [key: string]: unknown;
  };
}

export type ClaudeHookEventName = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse';

/** Hook stdout JSON (https://code.claude.com/docs/en/hooks#json-output). */
export interface ClaudeHookOutput {
  /** PostToolUse/UserPromptSubmit: "block" — for PostToolUse adds `reason` next to the tool result. */
  decision?: 'block';
  reason?: string;
  /** Warning shown to the user (not to Claude). */
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: ClaudeHookEventName;
    additionalContext?: string;
    /** PreToolUse (Claude Code and Codex): `deny` stops the tool call and shows `permissionDecisionReason` to the agent. */
    permissionDecision?: 'deny';
    permissionDecisionReason?: string;
  };
}

export interface ClaudeHookCommand {
  type: 'command';
  command: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

export interface HookGroup {
  matcher?: string;
  hooks: ClaudeHookCommand[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

/** Marker appended (as a shell comment) to every FlowLens-managed hook command. */
export const FLOWLENS_HOOK_MARKER = '# flowlens-managed';

export type ClaudeSettingsErrorCode = 'invalid_json' | 'invalid_shape' | 'io';

/**
 * Which Claude Code settings file hooks go into (Phase 12 review M3):
 * - `local` (default): `.claude/settings.local.json` — personal, kept out of
 *   git; right for the default command, which embeds this machine's
 *   absolute FlowLens path.
 * - `shared`: `.claude/settings.json` — committed for the team; uses a
 *   portable `npx --no-install flowlens` command when FlowLens is a local
 *   dependency of the project, else warns about the absolute path.
 */
export type ClaudeSettingsScope = 'local' | 'shared';

export interface ClaudeCodeHookInstallOptions {
  project_dir: string;
  /** Base command used to invoke FlowLens; defaults to `node "<abs dist/cli/index.js>"` (portable npx form when shared and possible). */
  command?: string;
  /** Rewrite FlowLens hooks even when they are already up to date. */
  force?: boolean;
  /** Write `.claude/settings.json` instead of `.claude/settings.local.json`. */
  shared?: boolean;
  /** Phase 23: install the PreToolUse edit gate (default true). The recorder hook is always installed. */
  gate?: boolean;
}

export interface AgentInstallResult {
  provider: AgentProvider;
  settings_path: string;
  hooks_added: number;
  hooks_existing: number;
  /** FlowLens hooks replaced (via --force or legacy/unmarked migration). */
  hooks_replaced?: number;
  /** Phase 23: FlowLens hooks that are no longer planned and were removed (e.g. the gate after --no-gate). */
  hooks_removed?: number;
  /** Backup of the previous settings file, when one existed. */
  backup_path?: string;
  /** Base command written into the hooks. */
  command?: string;
  /** Phase 12: which settings file was written. */
  scope?: ClaudeSettingsScope;
  /** FlowLens hooks removed from the other settings file (no duplicate hook runs). */
  hooks_moved?: number;
  /** The other settings file, when hooks were moved out of it. */
  moved_from?: string;
  /** Local scope: how `.claude/settings.local.json` is kept out of git (e.g. `.git/info/exclude`). */
  git_ignored_via?: string;
  warnings?: string[];
}

export interface AgentUninstallResult {
  provider: AgentProvider;
  settings_path: string;
  hooks_removed: number;
  backup_path?: string;
  /** False when no settings file existed (nothing was written). */
  settings_found?: boolean;
  /** Phase 12: every settings file that was checked, with what was removed from it. */
  files?: Array<{ path: string; hooks_removed: number; backup_path?: string }>;
}

/** What an agent command produced; the CLI writes it and sets the exit code. */
export interface AgentCommandResult {
  exit_code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}
