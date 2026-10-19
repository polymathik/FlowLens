import { describe, expect, it } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentInstallResult } from '../../../../src/contracts/agent.js';
import { runAgentSetup, type SetupDeps } from '../../../../src/agent/setup/run-setup.js';
import { fakeCli, tempProject } from './helpers.js';

const COMMAND = 'node "/opt/fl/dist/cli/index.js"';
const hookResult = (provider: 'claude-code' | 'codex'): AgentInstallResult => ({ provider, settings_path: '/x/settings', hooks_added: 5, hooks_existing: 0, scope: 'local', command: COMMAND });

function deps(home: string, over: Partial<SetupDeps> = {}): { d: SetupDeps; gates: Array<boolean | undefined> } {
  const gates: Array<boolean | undefined> = [];
  return {
    gates,
    d: {
      cli: fakeCli(), homeDir: home,
      installClaudeHooks: async (o) => { gates.push(o.gate); return hookResult('claude-code'); },
      installCodexHooks: async (o) => { gates.push(o.gate); return hookResult('codex'); },
      ...over,
    },
  };
}

describe('runAgentSetup', () => {
  it('connects MCP then hooks with the gate when MCP is connected', async () => {
    const { proj, home } = await tempProject();
    const { d, gates } = deps(home);
    const [r] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', command: COMMAND }, d);
    expect(r.mcp?.changed).toBe(true);
    expect(r.hooks?.hooks_added).toBe(5);
    expect(gates).toEqual([true]);
  });

  it('--no-gate passes gate:false; --no-mcp skips MCP, and without an existing connection the gate is not installed', async () => {
    const { proj, home } = await tempProject();
    const a = deps(home);
    await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', gate: false, command: COMMAND }, a.d);
    expect(a.gates).toEqual([false]);

    const b = deps(home);
    const [r] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', mcp: false, command: COMMAND }, b.d);
    expect(r.mcp).toBeUndefined();
    expect(b.gates).toEqual([false]);
    expect(r.notes.join(' ')).toMatch(/edit gate was not installed/);
  });

  it('--no-mcp keeps the gate when an earlier run already connected MCP', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: { command: 'npx', args: ['flowlens', 'serve'] } } }));
    const a = deps(home);
    await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', mcp: false }, a.d);
    expect(a.gates).toEqual([true]);
  });

  it('--no-hooks installs only MCP', async () => {
    const { proj, home } = await tempProject();
    const a = deps(home);
    const [r] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', hooks: false, command: COMMAND }, a.d);
    expect(r.mcp).toBeDefined();
    expect(r.hooks).toBeUndefined();
    expect(a.gates).toEqual([]);
  });

  it('an MCP failure does not stop the hooks (without the gate); a hooks failure keeps the MCP result', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), '{ broken');
    const a = deps(home, { cli: fakeCli({ present: false }) });
    const [r] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', command: COMMAND }, a.d);
    expect(r.mcp).toBeUndefined();
    expect(r.hooks).toBeDefined();
    expect(a.gates).toEqual([false]);
    expect(r.notes.join(' ')).toMatch(/could not register the MCP server .*not valid JSON/);
    expect(await readFile(join(proj, '.mcp.json'), 'utf-8')).toBe('{ broken');

    const b = deps(home, { installClaudeHooks: async () => { throw new Error('settings broken'); } });
    const [r2] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'local', command: COMMAND }, b.d);
    expect(r2.mcp).toBeDefined();
    expect(r2.hooks).toBeUndefined();
    expect(r2.notes.join(' ')).toMatch(/could not install hooks \(settings broken\)/);
  });

  it('one provider failing entirely does not abort the other', async () => {
    const { proj, home } = await tempProject();
    const a = deps(home, { installCodexHooks: async () => { throw new Error('codex hooks exploded'); } });
    const out = await runAgentSetup({ project_dir: proj, providers: ['codex', 'claude-code'], scope: 'shared', command: 'npx --no-install flowlens' }, a.d);
    expect(out.map((r) => r.provider)).toEqual(['codex', 'claude-code']);
    expect(out[0].mcp?.method).toBe('codex-config');
    expect(out[0].hooks).toBeUndefined();
    expect(out[1].mcp?.method).toBe('mcp-json');
    expect(out[1].hooks).toBeDefined();
    expect(out[0].notes.join(' ')).toMatch(/hooks exploded/);
  });

  it('notes carry the approval and trust facts', async () => {
    const { proj, home } = await tempProject();
    const a = deps(home);
    const [claude] = await runAgentSetup({ project_dir: proj, providers: ['claude-code'], scope: 'shared', command: 'npx --no-install flowlens' }, a.d);
    expect(claude.notes.join(' ')).toMatch(/approve a server from a project \.mcp\.json/);
    const [codex] = await runAgentSetup({ project_dir: proj, providers: ['codex'], scope: 'local', command: COMMAND }, a.d);
    expect(codex.notes.join(' ')).toMatch(/trusted projects/);
    expect(codex.notes.join(' ')).toMatch(/\/hooks/);
  });

  it('a hand-written Codex flowlens table counts as connected and is untouched', async () => {
    const { proj, home } = await tempProject();
    await mkdir(join(proj, '.codex'));
    await writeFile(join(proj, '.codex/config.toml'), '[mcp_servers.flowlens]\ncommand = "flowlens"\n');
    const a = deps(home);
    const [r] = await runAgentSetup({ project_dir: proj, providers: ['codex'], scope: 'shared' }, a.d);
    expect(r.mcp?.changed).toBe(false);
    expect(await readFile(join(proj, '.codex/config.toml'), 'utf-8')).toBe('[mcp_servers.flowlens]\ncommand = "flowlens"\n');
  });
});
