import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectMcpConnection } from '../../../../src/agent/setup/mcp-detect.js';
import { tempProject, writeClaudeJson } from './helpers.js';

const FL = { type: 'stdio', command: 'npx', args: ['--no-install', 'flowlens', 'serve'] };

describe('detectMcpConnection: Claude Code', () => {
  it('connected via project .mcp.json (by name or by command)', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: FL } }));
    expect(await detectMcpConnection(proj, 'claude-code', { homeDir: home })).toEqual({ state: 'connected', via: '.mcp.json' });
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { graph: FL } }));
    expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('connected');
  });

  it('connected via ~/.claude.json local and user scope', async () => {
    const { proj, home } = await tempProject();
    await writeClaudeJson(home, proj, { flowlens: FL });
    expect(await detectMcpConnection(proj, 'claude-code', { homeDir: home })).toEqual({ state: 'connected', via: '~/.claude.json (local scope)' });
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { flowlens: FL }, projects: {} }));
    expect(await detectMcpConnection(proj, 'claude-code', { homeDir: home })).toEqual({ state: 'connected', via: '~/.claude.json (user scope)' });
  });

  it('not_connected when ~/.claude.json is readable and has nothing; also for other projects only', async () => {
    const { proj, home } = await tempProject();
    await writeClaudeJson(home, '/some/other/project', { flowlens: FL });
    expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('not_connected');
  });

  it('a .mcp.json server the user disabled in Claude Code is not connected', async () => {
    const { proj, home } = await tempProject();
    await writeFile(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { flowlens: FL } }));
    await writeClaudeJson(home, proj, {}, { disabledMcpjsonServers: ['flowlens'] });
    const r = await detectMcpConnection(proj, 'claude-code', { homeDir: home });
    expect(r.state).toBe('not_connected');
    expect(r.via).toMatch(/disabled/);
  });

  it('unknown when nothing is readable: no ~/.claude.json, garbage, or a non-object', async () => {
    const { proj, home } = await tempProject();
    expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('unknown');
    await writeFile(join(home, '.claude.json'), '{ garbage');
    expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('unknown');
    await writeFile(join(home, '.claude.json'), '[1,2]');
    await writeFile(join(proj, '.mcp.json'), '\u0000\u0001 not json');
    expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('unknown');
  });

  it('never throws for a project path that does not exist', async () => {
    const r = await detectMcpConnection('/definitely/not/here', 'claude-code', { homeDir: '/definitely/not/home' });
    expect(r.state).toBe('unknown');
  });
});

describe('detectMcpConnection: Codex', () => {
  it('reads the project config (managed block or hand-written) and falls back to the user config', async () => {
    const { proj, home } = await tempProject();
    expect((await detectMcpConnection(proj, 'codex', { homeDir: home })).state).toBe('not_connected');
    await mkdir(join(proj, '.codex'));
    await writeFile(join(proj, '.codex/config.toml'), 'model = "x"\n[mcp_servers.other]\ncommand = "o"\n');
    expect((await detectMcpConnection(proj, 'codex', { homeDir: home })).state).toBe('not_connected');
    await writeFile(join(proj, '.codex/config.toml'), '# >>> flowlens-managed >>>\n[mcp_servers.flowlens]\ncommand = "node"\n# <<< flowlens-managed <<<\n');
    expect(await detectMcpConnection(proj, 'codex', { homeDir: home })).toEqual({ state: 'connected', via: '.codex/config.toml' });
    await writeFile(join(proj, '.codex/config.toml'), '');
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex/config.toml'), '[mcp_servers.flowlens]\ncommand = "flowlens"\nargs = ["serve"]\n');
    expect(await detectMcpConnection(proj, 'codex', { homeDir: home })).toEqual({ state: 'connected', via: '~/.codex/config.toml' });
  });

  it('a disabled server is not connected; garbage does not throw', async () => {
    const { proj, home } = await tempProject();
    await mkdir(join(proj, '.codex'));
    await writeFile(join(proj, '.codex/config.toml'), '[mcp_servers.flowlens]\ncommand = "node"\nenabled = false\n');
    expect((await detectMcpConnection(proj, 'codex', { homeDir: home })).state).toBe('not_connected');
    await writeFile(join(proj, '.codex/config.toml'), '=== ][ \u0000');
    expect((await detectMcpConnection(proj, 'codex', { homeDir: home })).state).toBe('not_connected');
  });
});
