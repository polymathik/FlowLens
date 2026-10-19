/**
 * `flowlens agent gate --hook` (PreToolUse on the edit tools). Holds an edit to a risky file until FlowLens
 * was queried for that file in this session (see gate.ts for the rules and the fail-open cases).
 *
 * Hot path: no graph is opened. It reads `.flowlens/agent.json`, the session's event log and (only for
 * hotspots) the cached digest. Any error allows the edit.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentCommandResult, ClaudeHookInput, ClaudeHookOutput } from '../contracts/agent.js';
import { GATE_ENV_VAR, type AgentLogEvent, type AgentProviderId } from '../contracts/agent-setup.js';
import { loadAgentConfig } from './agent-config.js';
import { readDigest } from './digest-cache.js';
import { decideGate, denyReason, type GateDecision, type GateWhy } from './gate.js';
import { flowlensDirFor } from './graph-access.js';
import { changedFilesFromHook } from './hook-input.js';
import { appendLogEvent, readSessionLog, safeSessionId } from './ledger.js';
import { getMcpState } from './mcp-state.js';

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'ApplyPatch']);
const ALLOW: AgentCommandResult = { exit_code: 0, stdout: '', stderr: '' };
const MAX_SYMBOLS = 5;
const SYMBOL_KINDS = new Set(['function', 'class', 'method', 'interface']);

export interface RunGateOptions {
  rootDir: string;
  hookInput: ClaudeHookInput;
  agent?: AgentProviderId;
  env?: NodeJS.ProcessEnv;
}

export async function runAgentGate(options: RunGateOptions): Promise<AgentCommandResult> {
  try {
    return await decide(options);
  } catch {
    return ALLOW; // fail open
  }
}

async function decide({ rootDir, hookInput, agent = 'claude-code', env = process.env }: RunGateOptions): Promise<AgentCommandResult> {
  const flowlensDir = flowlensDirFor(rootDir);
  const sessionId = safeSessionId(hookInput.session_id);
  if (!sessionId || !existsSync(flowlensDir) || !EDIT_TOOLS.has(hookInput.tool_name ?? '')) return ALLOW;
  const files = changedFilesFromHook(hookInput, rootDir);
  if (files.length === 0) return ALLOW;

  const { config } = await loadAgentConfig(flowlensDir);
  const envOff = /^(off|0|false)$/i.test(env[GATE_ENV_VAR] ?? '');
  if (envOff || !config.enabled) return ALLOW;

  const events = await readSessionLog(flowlensDir, sessionId);
  const queried = new Set(events.flatMap((e) => (e.t === 'query' ? e.files : [])));
  const denials = (file: string) => events.filter((e) => e.t === 'gate' && e.decision === 'deny' && e.file === file).length;
  const digest = await readDigest(flowlensDir).catch(() => null);
  const hotspotFiles = new Set<string>();
  for (const h of digest?.hotspots ?? []) {
    if (hotspotFiles.size >= config.hotspots) break;
    hotspotFiles.add((h as { file?: string }).file ?? '');
  }
  const mcp = await getMcpState(rootDir, agent);

  const results = files.map((file) => ({
    file,
    decision: decideGate({ file, exists: existsSync(join(rootDir, file)), config, hotspotFiles, queried, denials: denials(file), envOff, mcp }),
  }));

  const now = new Date().toISOString();
  const log = (file: string, d: GateDecision) => appendLogEvent(flowlensDir, {
    t: 'gate', ts: now, session_id: sessionId, file, decision: d.verdict, why: d.why,
  } satisfies AgentLogEvent);
  const gated = results.filter((r) => r.decision.why === 'checked' || r.decision.why === 'path' || r.decision.why === 'hotspot');
  await Promise.all(gated.map((r) => log(r.file, r.decision)));

  const denied = results.filter((r) => r.decision.verdict === 'deny');
  if (denied.length > 0) {
    const reason = denyReason(denied.map((r) => ({ file: r.file, why: r.decision.why as GateWhy, symbols: symbolsOf(digest, r.file) })));
    const output: ClaudeHookOutput = {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    };
    return { exit_code: 0, stdout: JSON.stringify(output), stderr: '' };
  }
  const relented = results.filter((r) => r.decision.verdict === 'relent');
  if (relented.length > 0) {
    const names = relented.map((r) => r.file).join(', ');
    const output: ClaudeHookOutput = {
      systemMessage: `FlowLens let an edit to ${names} through after ${config.max_denials} blocked attempts. The FlowLens tools may be unavailable; run "flowlens doctor".`,
    };
    return { exit_code: 0, stdout: JSON.stringify(output), stderr: '' };
  }
  return ALLOW;
}

/** The file's most depended-on symbols (from the cached digest), to name in the denial. */
function symbolsOf(digest: Awaited<ReturnType<typeof readDigest>>, file: string): string[] {
  if (!digest) return [];
  return digest.entities
    .filter((row) => row[4] === file && SYMBOL_KINDS.has(row[1]))
    .sort((a, b) => (b[12] ?? 0) - (a[12] ?? 0) || a[2].localeCompare(b[2]))
    .slice(0, MAX_SYMBOLS)
    .map((row) => row[2]);
}
