/** Plain-language text for setup results and integration status (CLI install / status / init). */
import type { AgentIntegrationStatus, AgentSetupResult } from '../../contracts/agent-setup.js';
import { PROVIDER_LABEL } from './run-setup.js';

const scopeText = (scope?: string): string => (scope === 'shared' ? 'shared with the team' : 'personal, not committed');

export function formatSetupResult(r: AgentSetupResult): string[] {
  const lines: string[] = [];
  const failed = !r.mcp && !r.hooks;
  lines.push(failed ? `${PROVIDER_LABEL[r.provider]}: nothing was changed.` : `${PROVIDER_LABEL[r.provider]} connected to FlowLens.`);
  if (r.mcp) {
    const how = r.mcp.method === 'claude-cli' ? 'registered with the claude CLI' : `written to ${r.mcp.path}`;
    lines.push(`  MCP server: ${r.mcp.changed ? how : 'already registered'} (${scopeText(r.mcp.scope)})`);
    lines.push(`    command: ${r.mcp.command}`);
    if (r.mcp.backup_path) lines.push(`    backup: ${r.mcp.backup_path}`);
  }
  if (r.hooks) {
    const h = r.hooks;
    lines.push(`  Hooks: ${h.settings_path} (${scopeText(h.scope)})`);
    lines.push(`    added ${h.hooks_added}, refreshed ${h.hooks_replaced ?? 0}, already up to date ${h.hooks_existing}${h.hooks_removed ? `, removed ${h.hooks_removed} superseded` : ''}`);
    if (h.hooks_moved) lines.push(`    moved ${h.hooks_moved} FlowLens hook(s) out of ${h.moved_from}`);
    if (h.git_ignored_via) lines.push(`    kept out of git via: ${h.git_ignored_via}`);
    if (h.backup_path) lines.push(`    backup: ${h.backup_path}`);
    for (const w of h.warnings ?? []) lines.push(`    Warning: ${w}`);
  }
  for (const note of r.notes) lines.push(`  - ${note}`);
  return lines;
}

export function formatStatus(s: AgentIntegrationStatus): string[] {
  const mcp = s.mcp === 'connected' ? `connected (${s.mcp_via ?? 'config'})`
    : s.mcp === 'not_connected' ? `not connected${s.mcp_via ? ` (${s.mcp_via})` : ''}` : 'unknown (the agent\'s own config is not readable from here)';
  const roles = (list: string[]): string => (list.length > 0 ? list.join(', ') : 'none');
  return [
    `${PROVIDER_LABEL[s.provider]}`,
    `  MCP server: ${mcp}`,
    `  Hooks installed: ${roles(s.hooks.installed)}`,
    ...(s.hooks.stale.length > 0 ? [`  Hooks out of date: ${roles(s.hooks.stale)}`] : []),
    ...(s.hooks.missing.length > 0 ? [`  Hooks missing: ${roles(s.hooks.missing)}`] : []),
    `  Edit gate: ${s.gate.enabled ? 'on' : 'off'}${s.gate.config_path ? ` (settings: ${s.gate.config_path})` : ' (defaults)'}${s.gate.error ? ` - ignored: ${s.gate.error}` : ''}`,
    ...(s.mcp !== 'connected' || s.hooks.missing.length > 0 || s.hooks.stale.length > 0 ? [`  Fix with: flowlens agent install ${s.provider}`] : []),
  ];
}
