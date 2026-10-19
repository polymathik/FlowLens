/**
 * The edit gate's decision, pure. An edit is held (`deny`) when the file is gated (a configured path glob,
 * or one of the top hotspot files) and FlowLens has not been queried for it in this session. Everything
 * else passes. The gate fails OPEN: a gate that can deadlock the agent is worse than none, so it lets the
 * edit through when it is disabled, when the MCP tools are known to be missing, for files that do not exist
 * yet, and after `max_denials` denials of the same file (the FlowLens tools may be failing).
 */
import { minimatch } from 'minimatch';
import type { AgentGateConfig, AgentLogEvent } from '../contracts/agent-setup.js';

export type GateWhy = Extract<AgentLogEvent, { t: 'gate' }>['why'];
export type GateVerdict = 'allow' | 'deny' | 'relent';

export interface GateInput {
  /** Repo-relative file with `/` separators. */
  file: string;
  /** False for a file the edit is about to create. */
  exists: boolean;
  config: AgentGateConfig;
  /** Top hotspot files (already limited to `config.hotspots`). */
  hotspotFiles: ReadonlySet<string>;
  /** Files FlowLens was queried for in this session. */
  queried: ReadonlySet<string>;
  /** How many times this file was already denied in this session. */
  denials: number;
  /** `FLOWLENS_GATE=off`. */
  envOff: boolean;
  mcp: 'connected' | 'not_connected' | 'unknown';
}

export interface GateDecision {
  verdict: GateVerdict;
  why: GateWhy;
}

const MATCH = { dot: true, nocase: false } as const;

export const matchesAny = (file: string, globs: readonly string[]): boolean => globs.some((g) => minimatch(file, g, MATCH));

export function decideGate(input: GateInput): GateDecision {
  const { file, config } = input;
  if (input.envOff || !config.enabled) return { verdict: 'allow', why: 'disabled' };
  if (input.mcp === 'not_connected') return { verdict: 'allow', why: 'unavailable' };
  if (!input.exists) return { verdict: 'allow', why: 'new_file' };
  if (matchesAny(file, config.exclude)) return { verdict: 'allow', why: 'not_gated' };
  const why: GateWhy | null = matchesAny(file, config.paths) ? 'path' : input.hotspotFiles.has(file) ? 'hotspot' : null;
  if (!why) return { verdict: 'allow', why: 'not_gated' };
  if (input.queried.has(file)) return { verdict: 'allow', why: 'checked' };
  if (config.max_denials > 0 && input.denials >= config.max_denials) return { verdict: 'relent', why };
  return { verdict: 'deny', why };
}

/** The message the agent sees when an edit is held: what, why, and the exact call that clears it. */
export function denyReason(files: Array<{ file: string; why: GateWhy; symbols: string[] }>): string {
  const lines = files.map(({ file, why, symbols }) => {
    const reason = why === 'path' ? 'in a protected path' : 'a hotspot (high churn and complexity)';
    const hint = symbols.length > 0 ? ` Symbols in it: ${symbols.join(', ')}.` : '';
    return `- ${file}: ${reason}.${hint}`;
  });
  const first = files[0].file;
  return [
    'FlowLens: this project holds edits to risky files until the graph has been checked for them in this session.',
    ...lines,
    `Call mcp__flowlens__get_dependents on the symbol(s) you will change (or mcp__flowlens__get_context with "${first}"), then retry the edit.`,
    'If the FlowLens tools are not available in this session, tell the user instead of retrying.',
  ].join('\n');
}
