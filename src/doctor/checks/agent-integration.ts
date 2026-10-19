/**
 * Agent integration check: is each coding agent that this project uses connected to FlowLens (MCP server +
 * hooks)? Only agents with a footprint in the project are examined (`.claude/`, `.mcp.json`, `.codex/`, or a
 * FlowLens connection), and a missing piece is a warning with the exact command to fix it, never an error.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentIntegrationStatus, AgentProviderId } from '../../contracts/agent-setup.js';
import type { DiagnosticCheck, DiagnosticRunner } from '../../contracts/doctor.js';
import { PROVIDER_LABEL } from '../../agent/setup/run-setup.js';
import { agentIntegrationStatus } from '../../agent/setup/status.js';

const BASE = { name: 'agent-integration', title: 'Coding agents connected' };

const FOOTPRINT: Record<AgentProviderId, string[]> = {
  'claude-code': ['.claude', '.mcp.json'],
  codex: ['.codex'],
};

/** Pure: one line per provider and whether it needs attention. */
export function describeIntegration(status: AgentIntegrationStatus): { line: string; ok: boolean; untouched: boolean } {
  const label = PROVIDER_LABEL[status.provider];
  const fix = `flowlens agent install ${status.provider}`;
  const { installed, stale, missing } = status.hooks;
  const nothing = status.mcp !== 'connected' && installed.length === 0 && stale.length === 0;
  if (nothing) return { line: `${label}: FlowLens is not connected (optional). Connect it with: ${fix}`, ok: false, untouched: true };
  const problems: string[] = [];
  if (status.mcp === 'not_connected') problems.push('MCP server not registered');
  if (missing.length > 0) problems.push(`hooks missing: ${missing.join(', ')}`);
  if (stale.length > 0) problems.push(`hooks out of date: ${stale.join(', ')}`);
  if (status.gate.error) problems.push(status.gate.error);
  if (problems.length > 0) return { line: `${label}: ${problems.join('; ')}. Fix with: ${fix}${stale.length > 0 ? ' --force' : ''}`, ok: false, untouched: false };
  const mcp = status.mcp === 'connected' ? `MCP connected via ${status.mcp_via ?? 'config'}` : 'MCP not visible from here (user-level config is not readable)';
  return { line: `${label}: ${mcp}; hooks ${installed.join(', ')}`, ok: true, untouched: false };
}

export const agentIntegrationCheck: DiagnosticRunner = async (ctx): Promise<DiagnosticCheck> => {
  try {
    const lines: Array<ReturnType<typeof describeIntegration>> = [];
    for (const provider of Object.keys(FOOTPRINT) as AgentProviderId[]) {
      const status = await agentIntegrationStatus(ctx.rootDir, provider);
      const present = FOOTPRINT[provider].some((p) => existsSync(join(ctx.rootDir, p)));
      if (!present && status.mcp !== 'connected') continue;
      lines.push(describeIntegration(status));
    }
    if (lines.length === 0) {
      return { ...BASE, status: 'skipped', message: 'no coding agent configured here (optional: flowlens agent install claude-code)' };
    }
    const attention = lines.filter((l) => !l.ok && !l.untouched);
    const untouched = lines.filter((l) => l.untouched);
    if (attention.length === 0 && untouched.length === lines.length) {
      return { ...BASE, status: 'skipped', message: 'FlowLens is not connected to a coding agent (optional)', details: lines.map((l) => l.line).join('\n') };
    }
    return {
      ...BASE,
      status: attention.length > 0 ? 'warning' : 'ok',
      message: attention.length > 0 ? `${attention.length} agent integration(s) need attention` : 'agent integrations are up to date',
      details: lines.map((l) => l.line).join('\n'),
    };
  } catch (err) {
    return { ...BASE, status: 'warning', message: `could not check agent integrations: ${err instanceof Error ? err.message : String(err)}` };
  }
};
