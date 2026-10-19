/**
 * The real CLI (tsx) against temp projects with a scratch HOME and a PATH that has `node` and `git` but no
 * `claude`/`codex`, so nothing here can touch the developer's agent configuration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { symlinkSync as linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCli, stopTestDaemon, TSX_CLI_COMMAND } from '../helpers.js';

const TIMEOUT = 120_000;

describe('agent install / status / uninstall and init flags (real CLI)', () => {
  let root: string;
  let proj: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], cwd = proj) => runCli(args, { cwd, env });

  beforeAll(async () => {
    // Real path: the CLI reports canonical (/private/var on macOS) project paths.
    root = realpathSync(await mkdtemp(join(tmpdir(), 'fl-setup-cli-')));
    proj = join(root, 'proj');
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    await mkdir(proj, { recursive: true });
    await mkdir(home);
    await mkdir(bin);
    linkSync(process.execPath, join(bin, 'node'));
    linkSync(execFileSync('which', ['git'], { encoding: 'utf-8' }).trim(), join(bin, 'git'));
    env = { HOME: home, USERPROFILE: home, PATH: bin };
    await writeFile(join(proj, 'a.ts'), 'export const a = 1;\n');
    execFileSync('git', ['init', '-q'], { cwd: proj });
  });

  afterAll(async () => {
    stopTestDaemon();
    await rm(root, { recursive: true, force: true });
  });

  it('status on a bare project lists both agents as not connected', () => {
    const r = cli(['agent', 'status', '--format', 'json']);
    expect(r.status).toBe(0);
    const list = JSON.parse(r.stdout) as Array<{ provider: string; mcp: string }>;
    expect(list.map((s) => s.provider)).toEqual(['claude-code', 'codex']);
    expect(list[1].mcp).toBe('not_connected');
    expect(cli(['agent', 'status']).stdout).toContain('Fix with: flowlens agent install claude-code');
  }, TIMEOUT);

  it('install claude-code without the claude CLI: .mcp.json + hooks, excluded from git, status connected, uninstall clean', async () => {
    const r = cli(['agent', 'install', 'claude-code', '--command', TSX_CLI_COMMAND, '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.provider).toBe('claude-code');
    expect(out.mcp).toMatchObject({ method: 'mcp-json', scope: 'local', changed: true });
    expect(out.settings_path).toBe(join(proj, '.claude/settings.local.json'));
    expect(out.notes.join(' ')).toMatch(/"claude" CLI was not found/);
    const mcp = JSON.parse(await readFile(join(proj, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.flowlens.args.at(-1)).toBe('serve');
    expect(await readFile(join(proj, '.git/info/exclude'), 'utf-8')).toContain('/.mcp.json');

    const status = JSON.parse(cli(['agent', 'status', '--format', 'json']).stdout)[0];
    expect(status.mcp).toBe('connected');
    expect(status.hooks.missing).toEqual([]);
    expect(status.hooks.installed).toEqual(expect.arrayContaining(['context', 'guard', 'record', 'gate']));

    const again = JSON.parse(cli(['agent', 'install', 'claude-code', '--command', TSX_CLI_COMMAND, '--format', 'json']).stdout);
    expect(again.mcp.changed).toBe(false);
    expect(again.hooks_added).toBe(0);

    const removed = cli(['agent', 'uninstall', 'claude-code', '--format', 'json']);
    expect(removed.status).toBe(0);
    expect(JSON.parse(removed.stdout).mcp.removed.join(' ')).toContain('.mcp.json');
    expect(existsSync(join(proj, '.mcp.json'))).toBe(false);
    expect(JSON.parse(await readFile(join(proj, '.claude/settings.local.json'), 'utf-8')).hooks).toEqual({});
  }, TIMEOUT);

  it('install claude-code --no-mcp --no-gate writes hooks only, without the gate', async () => {
    const r = cli(['agent', 'install', 'claude-code', '--no-mcp', '--no-gate', '--command', TSX_CLI_COMMAND, '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).mcp).toBeUndefined();
    expect(existsSync(join(proj, '.mcp.json'))).toBe(false);
    const hooks = JSON.parse(await readFile(join(proj, '.claude/settings.local.json'), 'utf-8')).hooks;
    expect(hooks.PreToolUse).toBeUndefined();
    cli(['agent', 'uninstall', 'claude-code']);
  }, TIMEOUT);

  it('malformed settings: exit 2 with the reason, MCP step still reported', async () => {
    await mkdir(join(proj, '.claude'), { recursive: true });
    await writeFile(join(proj, '.claude/settings.local.json'), '{ broken');
    const r = cli(['agent', 'install', 'claude-code', '--command', TSX_CLI_COMMAND]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not valid JSON');
    expect(await readFile(join(proj, '.claude/settings.local.json'), 'utf-8')).toBe('{ broken');
    cli(['agent', 'uninstall', 'claude-code', '--shared']);
    await rm(join(proj, '.claude'), { recursive: true, force: true });
    await rm(join(proj, '.mcp.json'), { force: true });
  }, TIMEOUT);

  it('install codex --shared: .codex/config.toml block and hooks.json, then uninstall', async () => {
    const r = cli(['agent', 'install', 'codex', '--shared', '--command', 'npx --no-install flowlens', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mcp).toMatchObject({ method: 'codex-config', scope: 'shared' });
    const toml = await readFile(join(proj, '.codex/config.toml'), 'utf-8');
    expect(toml).toContain('[mcp_servers.flowlens]');
    expect(toml).toContain('command = "npx"');
    expect(existsSync(join(proj, '.codex/hooks.json'))).toBe(true);
    expect(JSON.parse(cli(['agent', 'status', '--format', 'json']).stdout)[1].mcp).toBe('connected');
    const u = cli(['agent', 'uninstall', 'codex', '--format', 'json']);
    expect(u.status).toBe(0);
    expect(existsSync(join(proj, '.codex/config.toml'))).toBe(false);
  }, TIMEOUT);

  it('init: no flags prints the hint; --agents with a typo exits 2 before indexing; --yes connects; --no-agent stays silent', async () => {
    const plain = cli(['init', '--no-daemon']);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout).toContain('Next: flowlens agent install claude-code (connects Claude Code: MCP tools + hooks)');
    expect(existsSync(join(proj, '.mcp.json'))).toBe(false);

    const bad = cli(['init', '--force', '--agents', 'cursor', '--no-daemon']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('Unknown agent "cursor"');

    const silent = cli(['init', '--force', '--no-agent', '--yes', '--no-daemon']);
    expect(silent.status).toBe(0);
    expect(silent.stdout).not.toContain('Next: flowlens agent install');
    expect(existsSync(join(proj, '.mcp.json'))).toBe(false);

    const yes = cli(['init', '--force', '--yes', '--no-daemon']);
    expect(yes.status, yes.stderr).toBe(0);
    expect(yes.stdout).toContain('Claude Code connected to FlowLens');
    expect(existsSync(join(proj, '.mcp.json'))).toBe(true);
    expect(existsSync(join(proj, '.claude/settings.local.json'))).toBe(true);
  }, 240_000);
});
