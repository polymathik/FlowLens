/**
 * Agent setup contract (Phase 23): connecting coding agents to FlowLens in one step, the edit gate,
 * and the usage event log behind `flowlens agent stats`.
 *
 * Three producers share these types:
 *  - hooks core   (src/agent/gate*, record*, ledger, guidance)  - writes the event log, decides the gate
 *  - setup        (src/agent/setup/**, mcp config writers, init prompt, doctor) - installs MCP + hooks
 *  - stats        (src/agent/stats/**) - reads the event log and the agents' own transcripts
 *
 * Everything is additive to `contracts/agent.ts`; nothing here changes an existing shape.
 */

/* ---------------- providers ---------------- */

/** Agents FlowLens can wire up (MCP server + hooks). Others get the MCP snippet from the README. */
export type AgentProviderId = 'claude-code' | 'codex';
export const AGENT_PROVIDERS: readonly AgentProviderId[] = ['claude-code', 'codex'];

/** Where MCP/hook config is written. `local` = personal (not committed), `shared` = committed for the team. */
export type AgentSetupScope = 'local' | 'shared';

/* ---------------- hook roles ---------------- */

/**
 * Every FlowLens-managed hook has exactly one role. The role is the key of the hook within its event
 * (so two FlowLens hooks on one event, e.g. two PostToolUse hooks, never replace each other) and is
 * written into the command marker: `# flowlens-managed:<role>`. A marker without a role is a
 * pre-Phase-23 hook and means the event's primary role (see `HOOK_PRIMARY_ROLE`).
 */
export type FlowLensHookRole = 'context' | 'guard' | 'gate' | 'record';

/** The role a role-less (legacy) marker has, per event. */
export const HOOK_PRIMARY_ROLE: Readonly<Record<string, FlowLensHookRole>> = {
  SessionStart: 'context',
  UserPromptSubmit: 'context',
  PostToolUse: 'guard',
  PreToolUse: 'gate',
};

/** Tool names whose use the gate guards (Claude Code names; Codex's `apply_patch` is matched as `Edit`/`Write`). */
export const GATED_EDIT_MATCHER = 'Edit|MultiEdit|Write|NotebookEdit|apply_patch';
/** Matcher of the recorder: every FlowLens MCP tool call (`mcp__<server>__<tool>`). */
export const FLOWLENS_TOOL_MATCHER = 'mcp__flowlens__.*';
/** The MCP server name FlowLens registers itself under (tool names become `mcp__flowlens__<tool>`). */
export const FLOWLENS_MCP_SERVER_NAME = 'flowlens';
export const FLOWLENS_TOOL_PREFIX = `mcp__${FLOWLENS_MCP_SERVER_NAME}__`;

/* ---------------- .flowlens/agent.json (user adjustments) ---------------- */

export const AGENT_CONFIG_FILE = 'agent.json';

/** Which edits the PreToolUse gate holds until FlowLens has been queried for the file. */
export interface AgentGateConfig {
  /** Master switch. Default true (the gate is only installed when MCP is connected, and fails open). */
  enabled: boolean;
  /** Globs (repo-relative, `/` separators) that are always gated, e.g. `packages/core/**`. Default none. */
  paths: string[];
  /** Globs never gated (tests, docs, config, generated). */
  exclude: string[];
  /** Also gate the N files with the highest hotspot score (0 = none). Default 10. */
  hotspots: number;
  /**
   * After this many denials of the same file in one session the gate lets the edit through and tells the
   * user (FlowLens tools may be unavailable). 0 = never relent. Default 3.
   */
  max_denials: number;
}

export interface AgentConfig {
  version: 1;
  gate?: Partial<AgentGateConfig>;
}

export const DEFAULT_AGENT_GATE: AgentGateConfig = {
  enabled: true,
  paths: [],
  exclude: [
    '**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**', '**/tests/**',
    '**/*.md', '**/*.mdx', '**/*.txt', '**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.lock',
    '**/dist/**', '**/build/**', '**/node_modules/**', '**/.flowlens/**', '**/.claude/**', '**/.codex/**',
  ],
  hotspots: 10,
  max_denials: 3,
};

/** Environment switch for one session or one shell: `FLOWLENS_GATE=off` disables the gate. */
export const GATE_ENV_VAR = 'FLOWLENS_GATE';

/* ---------------- usage event log (.flowlens/agent-ledger/<session_id>.jsonl) ---------------- */

/** One JSON object per line; unknown event types must be ignored by readers. */
export const AGENT_LEDGER_DIR = 'agent-ledger';
/** Ledgers untouched for this long are removed at session start. */
export const AGENT_LEDGER_RETENTION_DAYS = 14;

interface LogBase {
  /** ISO timestamp. */
  ts: string;
  session_id: string;
}

export type AgentLogEvent =
  /** First record of a session (SessionStart hook); lets stats find the agent's transcript. */
  | (LogBase & { t: 'session'; provider: AgentProviderId; source?: string; transcript_path?: string; cwd?: string })
  /** Context injected into the agent (SessionStart / UserPromptSubmit hooks). */
  | (LogBase & { t: 'inject'; event: 'session_start' | 'prompt_submit'; chars: number; relevant_files: number; tools_hint: boolean })
  /** A FlowLens MCP tool call (PostToolUse recorder). `files` = repo-relative files it covers. */
  | (LogBase & { t: 'query'; tool: string; files: string[]; response_chars: number })
  /** A gate decision on an edit (PreToolUse gate). `relent` = let through after `max_denials`. */
  | (LogBase & { t: 'gate'; file: string; decision: 'allow' | 'deny' | 'relent'; why: 'checked' | 'path' | 'hotspot' | 'not_gated' | 'new_file' | 'disabled' | 'unavailable' })
  /** Result of the post-edit guard (PostToolUse guard hook). */
  | (LogBase & { t: 'guard'; files: string[]; risk: 'none' | 'low' | 'medium' | 'high'; blocked: boolean });

/* ---------------- setup ---------------- */

export interface AgentSetupRequest {
  project_dir: string;
  providers: AgentProviderId[];
  scope: AgentSetupScope;
  /** Register the FlowLens MCP server (default true). */
  mcp?: boolean;
  /** Install hooks: context, guard, record (default true). */
  hooks?: boolean;
  /** Install the PreToolUse edit gate (default true; needs `hooks`; only meaningful with MCP connected). */
  gate?: boolean;
  /** Rewrite FlowLens entries even when up to date. */
  force?: boolean;
  /** Base command override (as `agent install --command`). */
  command?: string;
}

export type McpInstallMethod = 'claude-cli' | 'mcp-json' | 'codex-config';

export interface McpInstallResult {
  provider: AgentProviderId;
  method: McpInstallMethod;
  scope: AgentSetupScope;
  /** File written, when one was (`.mcp.json`, `.codex/config.toml`, `~/.codex/config.toml`). */
  path?: string;
  /** False when the server was already registered identically. */
  changed: boolean;
  /** The command the agent will run to start the server, e.g. `node /abs/dist/cli/index.js serve`. */
  command: string;
  backup_path?: string;
  warnings?: string[];
}

export interface AgentSetupResult {
  provider: AgentProviderId;
  mcp?: McpInstallResult;
  /** Hooks result in the existing shape (contracts/agent.ts AgentInstallResult). */
  hooks?: import('./agent.js').AgentInstallResult;
  /** Things the user should know (a manual step, a trust prompt, something skipped). */
  notes: string[];
}

/** Doctor / `agent status`: what is wired up for one provider in this project. */
export interface AgentIntegrationStatus {
  provider: AgentProviderId;
  /** `unknown` when the agent's own config cannot be read (e.g. user-scoped config not visible). */
  mcp: 'connected' | 'not_connected' | 'unknown';
  mcp_via?: string;
  /** Hook roles found installed and up to date / present but stale (command differs) / missing. */
  hooks: { installed: FlowLensHookRole[]; stale: FlowLensHookRole[]; missing: FlowLensHookRole[] };
  gate: { enabled: boolean; config_path: string | null; error?: string };
}

/* ---------------- stats ---------------- */

export interface AgentSessionStats {
  session_id: string;
  provider: AgentProviderId | 'unknown';
  started: string;
  /** Hook activity from the event log. */
  injections: number;
  injected_chars: number;
  flowlens_calls: number;
  /** FlowLens MCP calls by tool name (without the mcp__flowlens__ prefix). */
  flowlens_by_tool: Record<string, number>;
  gate: { allow: number; deny: number; relent: number };
  guard_runs: number;
  /** From the agent's transcript, when it was found; null otherwise. */
  transcript: null | {
    path: string;
    turns: number;
    /** Tool calls by name (Read, Grep, Glob, Bash, Edit, mcp__flowlens__…). */
    tool_calls: Record<string, number>;
    /** File-discovery calls: Read + Grep + Glob (+ Codex equivalents). */
    search_calls: number;
    tokens: { input: number; output: number; cache_read: number; cache_write: number };
  };
}
