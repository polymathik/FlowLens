import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installClaudeMcp, uninstallClaudeMcp } from '../../../../src/agent/setup/mcp-claude.js';
import { realCliDeps, parseCliGet, whichSync } from '../../../../src/agent/setup/claude-cli.js';
import { fakeCli, tempProject, writeClaudeJson } from './helpers.js';

const COMMAND = 'node "/opt/fl/dist/cli/index.js"';
const ARGV = { command: 'node', args: ['/opt/fl/dist/cli/index.js', 'serve'] };

describe('installClaudeMcp (local scope, claude CLI)', () => {
  it('adds with the documented flags and verifies with `mcp get`', async () => {
    const { proj, home } = await tempProject();
    const cli = fakeCli();
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: cli, homeDir: home });
    expect(r).toMatchObject({ method: 'claude-cli', scope: 'local', changed: true });
    expect(cli.calls[0]).toEqual(['mcp', 'add', '--transport', 'stdio', '--scope', 'local', 'flowlens', '--', 'node', '/opt/fl/dist/cli/index.js', 'serve']);
    expect(cli.calls.at(-1)).toEqual(['mcp', 'get', 'flowlens']);
    expect(r.warnings).toBeUndefined();
  });

  it('is a no-op when ~/.claude.json already has the same entry', async () => {
    const { proj, home } = await tempProject();
    await writeClaudeJson(home, proj, { flowlens: { type: 'stdio', ...ARGV } });
    const cli = fakeCli({ existing: ARGV });
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: cli, homeDir: home });
    expect(r.changed).toBe(false);
    expect(cli.calls).toEqual([]);
  });

  it('replaces a differing entry: remove, then add', async () => {
    const { proj, home } = await tempProject();
    const old = { command: 'node', args: ['/old/flowlens.js', 'serve'] };
    await writeClaudeJson(home, proj, { flowlens: old });
    const cli = fakeCli({ existing: old });
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: cli, homeDir: home });
    expect(r.changed).toBe(true);
    expect(cli.calls.map((c) => c[1])).toEqual(['remove', 'add', 'get']);
  });

  it('recovers when the entry exists but could not be seen (remove, retry add)', async () => {
    const { proj, home } = await tempProject();
    const cli = fakeCli({ existing: { command: 'x', args: [] } });
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: cli, homeDir: home });
    expect(r.changed).toBe(true);
    expect(cli.calls.map((c) => c[1])).toEqual(['add', 'remove', 'add', 'get']);
  });

  it('restores the previous entry when add fails', async () => {
    const { proj, home } = await tempProject();
    const old = { command: 'node', args: ['/old/flowlens.js', 'serve'] };
    await writeClaudeJson(home, proj, { flowlens: old });
    let adds = 0;
    const base = fakeCli({ existing: old });
    const cli = { ...base, run: async (f: string, a: string[], o: { cwd: string; timeoutMs: number }) => {
      if (a[1] === 'add' && adds++ === 0) { base.calls.push(a); return { code: 1, stdout: '', stderr: 'nope' }; }
      return base.run(f, a, o);
    } };
    await expect(installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: cli, homeDir: home })).rejects.toThrow(/previous registration was restored/);
    const adds2 = base.calls.filter((c) => c[1] === 'add');
    expect(adds2).toHaveLength(2);
    expect(adds2[1].slice(-3)).toEqual(['/old/flowlens.js', 'serve'].length === 2 ? ['node', '/old/flowlens.js', 'serve'] : []);
  });

  it('warns (does not fail) when the health check cannot connect', async () => {
    const { proj, home } = await tempProject();
    const getText = 'flowlens:\n  Scope: Local config\n  Status: × Failed to connect\n  Issue: CONNECTION_CLOSED\n  Type: stdio\n  Command: node\n  Args: /opt/fl/dist/cli/index.js serve\n';
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: fakeCli({ getText }), homeDir: home });
    expect(r.changed).toBe(true);
    expect(r.warnings?.join(' ')).toMatch(/could not start the server/);
  });

  it('falls back to .mcp.json when the claude CLI is missing: warns, excludes it from git', async () => {
    const { proj, home } = await tempProject();
    execFileSync('git', ['init', '-q'], { cwd: proj });
    const r = await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: fakeCli({ present: false }), homeDir: home });
    expect(r).toMatchObject({ method: 'mcp-json', scope: 'local', changed: true, path: join(proj, '.mcp.json') });
    expect(r.warnings?.join(' ')).toMatch(/"claude" CLI was not found/);
    expect(r.warnings?.join(' ')).toMatch(/absolute path/);
    expect(await readFile(join(proj, '.git/info/exclude'), 'utf-8')).toContain('/.mcp.json');
  });

  it('does not exclude an existing .mcp.json it only edited', async () => {
    const { proj, home } = await tempProject();
    execFileSync('git', ['init', '-q'], { cwd: proj });
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    await installClaudeMcp({ projectDir: proj, scope: 'local', command: COMMAND, deps: fakeCli({ present: false }), homeDir: home });
    expect(existsSync(join(proj, '.git/info/exclude')) ? await readFile(join(proj, '.git/info/exclude'), 'utf-8') : '').not.toContain('.mcp.json');
  });

  it('shared scope writes .mcp.json and never calls the CLI', async () => {
    const { proj, home } = await tempProject();
    const cli = fakeCli();
    const r = await installClaudeMcp({ projectDir: proj, scope: 'shared', command: 'npx --no-install flowlens', deps: cli, homeDir: home });
    expect(r).toMatchObject({ method: 'mcp-json', scope: 'shared', changed: true, command: 'npx --no-install flowlens serve' });
    expect(cli.calls).toEqual([]);
    expect(JSON.parse(await readFile(join(proj, '.mcp.json'), 'utf-8')).mcpServers.flowlens).toEqual({ type: 'stdio', command: 'npx', args: ['--no-install', 'flowlens', 'serve'] });
  });
});

describe('uninstallClaudeMcp', () => {
  it('removes the local registration through the CLI and our .mcp.json entry; leaves others', async () => {
    const { proj, home } = await tempProject();
    await writeClaudeJson(home, proj, { flowlens: ARGV });
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: { command: 'npx', args: ['--no-install', 'flowlens', 'serve'] }, github: { url: 'u' } } }));
    const cli = fakeCli({ existing: ARGV });
    const r = await uninstallClaudeMcp(proj, { deps: cli, homeDir: home });
    expect(r.removed).toEqual(['claude mcp remove flowlens --scope local', '.mcp.json entry "flowlens"']);
    expect(cli.calls[0]).toEqual(['mcp', 'remove', 'flowlens', '--scope', 'local']);
    expect(JSON.parse(await readFile(join(proj, '.mcp.json'), 'utf-8')).mcpServers).toEqual({ github: { url: 'u' } });
  });

  it('--shared leaves the personal registration; --local leaves a portable shared entry', async () => {
    const { proj, home } = await tempProject();
    await writeClaudeJson(home, proj, { flowlens: ARGV });
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: { command: 'npx', args: ['--no-install', 'flowlens', 'serve'] } } }));
    const cli = fakeCli({ existing: ARGV });
    const shared = await uninstallClaudeMcp(proj, { scope: 'shared', deps: cli, homeDir: home });
    expect(cli.calls).toEqual([]);
    expect(shared.removed).toEqual(['.mcp.json (deleted, it only held FlowLens)']);
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: { command: 'npx', args: ['--no-install', 'flowlens', 'serve'] } } }));
    const local = await uninstallClaudeMcp(proj, { scope: 'local', deps: cli, homeDir: home });
    expect(local.removed).toEqual(['claude mcp remove flowlens --scope local']);
    expect(existsSync(join(proj, '.mcp.json'))).toBe(true);
  });

  it('reports an invalid .mcp.json instead of overwriting it', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), '{ nope');
    await expect(uninstallClaudeMcp(proj, { deps: fakeCli(), homeDir: home })).rejects.toThrow(/not valid JSON/);
  });
});

describe('claude CLI helpers', () => {
  it('parses `mcp get` output', () => {
    const ok = parseCliGet('flowlens:\n  Scope: Local config\n  Status: ✓ Connected\n  Command: node\n  Args: a b\n');
    expect(ok).toMatchObject({ found: true, connected: true, command: 'node', args: 'a b' });
    expect(parseCliGet('x:\n  Status: × Failed to connect\n  Command: node\n').connected).toBe(false);
    expect(parseCliGet('No MCP server named "x"').found).toBe(false);
  });
  it('whichSync finds nothing for a bogus name', () => {
    expect(whichSync('definitely-not-a-binary-xyz')).toBeNull();
    expect(realCliDeps.which('definitely-not-a-binary-xyz')).toBeNull();
  });
});
