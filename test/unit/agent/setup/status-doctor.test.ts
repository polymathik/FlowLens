import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installClaudeCodeHooks } from '../../../../src/agent/claude-code.js';
import { installCodexHooks } from '../../../../src/agent/codex-hooks.js';
import { agentIntegrationStatus } from '../../../../src/agent/setup/status.js';
import { agentIntegrationCheck, describeIntegration } from '../../../../src/doctor/checks/agent-integration.js';
import { ALL_CHECKS } from '../../../../src/doctor/checks/index.js';
import { formatStatus } from '../../../../src/agent/setup/format.js';
import { tempProject } from './helpers.js';

const FL_SERVER = { mcpServers: { flowlens: { type: 'stdio', command: 'npx', args: ['--no-install', 'flowlens', 'serve'] } } };

describe('agentIntegrationStatus', () => {
  it('reports nothing connected in a bare project', async () => {
    const { proj, home } = await tempProject();
    const s = await agentIntegrationStatus(proj, 'claude-code', { homeDir: home });
    expect(s.mcp).toBe('unknown');
    expect(s.hooks.installed).toEqual([]);
    expect(s.hooks.missing.length).toBeGreaterThan(0);
    expect(s.gate).toEqual({ enabled: true, config_path: null });
  });

  it('sees installed Claude Code hooks and a connected MCP server', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify(FL_SERVER));
    await installClaudeCodeHooks({ project_dir: proj, gate: true });
    const s = await agentIntegrationStatus(proj, 'claude-code', { homeDir: home });
    expect(s.mcp).toBe('connected');
    expect(s.mcp_via).toBe('.mcp.json');
    expect(s.hooks.missing).toEqual([]);
    expect(s.hooks.stale).toEqual([]);
    expect(s.hooks.installed).toEqual(expect.arrayContaining(['context', 'guard', 'record', 'gate']));
  });

  it('flags a hook with a different command as stale and a removed one as missing', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify(FL_SERVER));
    await installClaudeCodeHooks({ project_dir: proj, gate: false, command: 'node /old/place/cli.js' });
    const s = await agentIntegrationStatus(proj, 'claude-code', { homeDir: home });
    expect(s.hooks.stale.length).toBeGreaterThan(0);
    expect(s.hooks.missing).toContain('gate');
  });

  it('does not expect the gate when MCP is not connected or the gate is switched off', async () => {
    const { proj, home } = await tempProject();
    await installClaudeCodeHooks({ project_dir: proj, gate: false });
    expect((await agentIntegrationStatus(proj, 'claude-code', { homeDir: home })).hooks.missing).toEqual([]);
    await writeFile(join(proj, '.mcp.json'), JSON.stringify(FL_SERVER));
    await mkdir(join(proj, '.flowlens'));
    await writeFile(join(proj, '.flowlens/agent.json'), JSON.stringify({ version: 1, gate: { enabled: false } }));
    const s = await agentIntegrationStatus(proj, 'claude-code', { homeDir: home });
    expect(s.hooks.missing).toEqual([]);
    expect(s.gate.enabled).toBe(false);
    await writeFile(join(proj, '.flowlens/agent.json'), '{ nope');
    expect((await agentIntegrationStatus(proj, 'claude-code', { homeDir: home })).gate.error).toMatch(/not valid JSON/);
  });

  it('works for Codex', async () => {
    const { proj, home } = await tempProject();
    await mkdir(join(proj, '.codex'));
    await writeFile(join(proj, '.codex/config.toml'), '[mcp_servers.flowlens]\ncommand = "flowlens"\n');
    await installCodexHooks({ project_dir: proj, gate: true });
    const s = await agentIntegrationStatus(proj, 'codex', { homeDir: home });
    expect(s.mcp).toBe('connected');
    expect(s.hooks.missing).toEqual([]);
    expect(s.hooks.installed.length).toBeGreaterThan(0);
    expect(formatStatus(s).join('\n')).toContain('Codex');
  });
});

describe('agent-integration doctor check', () => {
  const run = (rootDir: string) => agentIntegrationCheck({ rootDir, flowlensDir: join(rootDir, '.flowlens') });

  it('is registered with the other checks', () => {
    expect(ALL_CHECKS).toContain(agentIntegrationCheck);
  });

  it('is skipped (never warns or fails) for a project that never used an agent', async () => {
    const { proj } = await tempProject();
    const r = await run(proj);
    expect(r.status).toBe('skipped');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('warns with the exact fix command when hooks exist but MCP is not connected', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: {} })); // readable, no FlowLens
    vi.stubEnv('HOME', home);
    await installClaudeCodeHooks({ project_dir: proj, gate: false });
    const r = await run(proj);
    expect(r.status).toBe('warning');
    expect(r.details).toContain('MCP server not registered');
    expect(r.details).toContain('Fix with: flowlens agent install claude-code');
  });

  it('describeIntegration words each state and names the fix', () => {
    const base = { provider: 'claude-code' as const, gate: { enabled: true, config_path: null } };
    const roles = (installed: string[], stale: string[], missing: string[]) => ({ installed, stale, missing }) as never;
    expect(describeIntegration({ ...base, mcp: 'not_connected', hooks: roles(['context'], [], ['gate']) }))
      .toMatchObject({ ok: false, line: expect.stringContaining('flowlens agent install claude-code') });
    expect(describeIntegration({ ...base, mcp: 'connected', hooks: roles(['context'], ['guard'], []) }).line).toContain('--force');
    expect(describeIntegration({ ...base, mcp: 'connected', mcp_via: '.mcp.json', hooks: roles(['context', 'gate'], [], []) })).toMatchObject({ ok: true });
    expect(describeIntegration({ ...base, mcp: 'unknown', hooks: roles(['context'], [], []) })).toMatchObject({ ok: true });
    expect(describeIntegration({ ...base, mcp: 'not_connected', hooks: roles([], [], ['context']) })).toMatchObject({ untouched: true });
  });

  it('reports ok when a connected provider is fully installed, warning when stale', async () => {
    const { proj } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify(FL_SERVER));
    await installClaudeCodeHooks({ project_dir: proj, gate: true });
    const ok = await run(proj);
    expect(ok.status).toBe('ok');
    await installClaudeCodeHooks({ project_dir: proj, gate: true, command: 'node /other/cli.js', force: true });
    const stale = await run(proj);
    expect(stale.status).toBe('warning');
    expect(stale.details).toContain('flowlens agent install claude-code');
  });
});
