/**
 * `.flowlens/agent.json`: user adjustments of the edit gate. Missing file → defaults. A malformed file
 * never breaks a hook: the defaults apply and the problem is returned so `doctor` can report it.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_CONFIG_FILE, DEFAULT_AGENT_GATE, type AgentGateConfig } from '../contracts/agent-setup.js';

export interface LoadedAgentConfig {
  config: AgentGateConfig;
  /** The file read, or null when there is none (defaults). */
  path: string | null;
  /** Why the file was ignored (invalid JSON, wrong types). */
  error?: string;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000;

/** Validate a parsed `agent.json`; returns the gate settings merged over the defaults, or an error. */
export function parseAgentConfig(value: unknown): { config: AgentGateConfig } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'must be a JSON object' };
  const root = value as Record<string, unknown>;
  if (root.version !== undefined && root.version !== 1) return { error: `unsupported version ${String(root.version)} (expected 1)` };
  const gate = root.gate;
  if (gate === undefined) return { config: { ...DEFAULT_AGENT_GATE } };
  if (typeof gate !== 'object' || gate === null || Array.isArray(gate)) return { error: '"gate" must be an object' };
  const g = gate as Record<string, unknown>;
  const out: AgentGateConfig = { ...DEFAULT_AGENT_GATE };
  if (g.enabled !== undefined) { if (typeof g.enabled !== 'boolean') return { error: 'gate.enabled must be true or false' }; out.enabled = g.enabled; }
  if (g.paths !== undefined) { if (!isStringArray(g.paths)) return { error: 'gate.paths must be an array of glob strings' }; out.paths = g.paths; }
  if (g.exclude !== undefined) { if (!isStringArray(g.exclude)) return { error: 'gate.exclude must be an array of glob strings' }; out.exclude = g.exclude; }
  if (g.hotspots !== undefined) { if (!isCount(g.hotspots)) return { error: 'gate.hotspots must be a whole number (0 = none)' }; out.hotspots = g.hotspots; }
  if (g.max_denials !== undefined) { if (!isCount(g.max_denials)) return { error: 'gate.max_denials must be a whole number (0 = never relent)' }; out.max_denials = g.max_denials; }
  return { config: out };
}

export async function loadAgentConfig(flowlensDir: string): Promise<LoadedAgentConfig> {
  const path = join(flowlensDir, AGENT_CONFIG_FILE);
  if (!existsSync(path)) return { config: { ...DEFAULT_AGENT_GATE }, path: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    return { config: { ...DEFAULT_AGENT_GATE }, path, error: `${AGENT_CONFIG_FILE} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const result = parseAgentConfig(parsed);
  return 'error' in result
    ? { config: { ...DEFAULT_AGENT_GATE }, path, error: `${AGENT_CONFIG_FILE}: ${result.error}` }
    : { config: result.config, path };
}
