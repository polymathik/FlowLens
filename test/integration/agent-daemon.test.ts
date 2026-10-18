/**
 * Phase 7 completion (wave 2) end to end: Claude Code hooks while
 * `flowlens serve --watch` is running — the old P0 (hooks reported "busy"
 * because serve held the LevelDB lock).
 *
 * Real processes only: an isolated $FLOWLENS_HOME daemon, `serve --watch`
 * driven by a real @modelcontextprotocol/sdk stdio client, and the INSTALLED
 * hook command strings run through `sh -c` with real hook JSON, concurrently.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AgentContextPacket, ClaudeHookOutput, ClaudeSettings } from '../../src/contracts/agent.js';
import { CLI_TS, TSX_LOADER, removeDir, runCli, tempDir } from '../helpers/service-env.js';
import { git, TSX_CLI_COMMAND } from '../unit/agent/helpers.js';

const TIMEOUT = 240_000;
type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/** Async `sh -c <installed command>` so several hooks really run at once. */
function runHook(command: string, input: object, env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const started = Date.now();
  return new Promise((done, fail) => {
    const child = spawn('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', fail);
    child.on('exit', (code) => done({ code: code ?? -1, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(JSON.stringify(input));
  });
}

describe('agent hooks + serve --watch through the daemon', () => {
  let home: string;
  let proj: string;
  let env: Record<string, string>;
  let mcp: Client;
  let commands: { session: string; prompt: string; guard: string };
  const parse = (stdout: string) => JSON.parse(stdout) as ClaudeHookOutput;
  const postToolUse = (file: string) => ({
    hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: proj,
    tool_input: { file_path: join(proj, file) }, tool_response: { filePath: join(proj, file) },
  });

  beforeAll(async () => {
    home = await tempDir('flowlens-home-');
    proj = await tempDir('flowlens-agent-daemon-');
    env = { FLOWLENS_HOME: home, FLOWLENS_NO_DAEMON: '', CLAUDE_PROJECT_DIR: proj };
    await mkdir(join(proj, 'src'));
    await writeFile(join(proj, 'src/a.ts'), "import { b } from './b';\nexport function alpha() { return b(); }\n");
    await writeFile(join(proj, 'src/b.ts'), "import { alpha } from './a';\nexport function b() { return 1; }\nexport function useAlpha() { return alpha(); }\n");
    await writeFile(join(proj, 'src/c.ts'), 'export function gamma() { return 3; }\n');
    await writeFile(join(proj, 'src/d.ts'), 'export function delta() { return 4; }\n');
    git(proj, ['init', '-q']);
    git(proj, ['add', '-A']);
    git(proj, ['commit', '-qm', 'init']);
    const init = await runCli(['init'], proj, env);
    expect(init.code, init.stderr).toBe(0);
    const install = await runCli(['agent', 'install', 'claude-code', '--command', TSX_CLI_COMMAND], proj, env);
    expect(install.code, install.stderr).toBe(0);
    const settings = JSON.parse(await readFile(join(proj, '.claude/settings.local.json'), 'utf-8')) as ClaudeSettings;
    commands = {
      session: settings.hooks!.SessionStart[0].hooks[0].command,
      prompt: settings.hooks!.UserPromptSubmit[0].hooks[0].command,
      guard: settings.hooks!.PostToolUse[0].hooks[0].command,
    };

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', TSX_LOADER, CLI_TS, 'serve', '--watch'],
      cwd: proj,
      env: { ...(process.env as Record<string, string>), ...env },
      stderr: 'pipe',
    });
    mcp = new Client({ name: 'flowlens-agent-daemon-test', version: '0.0.0' });
    await mcp.connect(transport);
  }, TIMEOUT);

  afterAll(async () => {
    await mcp?.close().catch(() => undefined);
    await runCli(['daemon', 'stop'], home, env);
    await removeDir(home);
    await removeDir(proj);
  }, TIMEOUT);

  it('SessionStart + UserPromptSubmit + MCP calls run concurrently with serve --watch', async () => {
    const [session, prompt, summary] = await Promise.all([
      runHook(commands.session, { hook_event_name: 'SessionStart', source: 'startup', cwd: proj }, env, proj),
      runHook(commands.prompt, { hook_event_name: 'UserPromptSubmit', prompt: 'make alpha faster', cwd: proj }, env, proj),
      mcp.callTool({ name: 'get_summary', arguments: {} }),
    ]);
    for (const run of [session, prompt]) {
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).not.toMatch(/unavailable|graph lock|did NOT check|stale|cached digest/i);
    }
    const ctx = parse(session.stdout).hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain('FlowLens Agent Context');
    expect(ctx).toContain('src/a.ts -> src/b.ts');
    expect(ctx).toMatch(/### Health\n- Grade [A-F] \(\d+\/100/);
    expect(ctx).toContain('flowlens://health');
    expect(parse(prompt.stdout).hookSpecificOutput?.additionalContext).toContain('src/a.ts');
    expect((summary as ToolResult).isError).toBeFalsy();
  }, TIMEOUT);

  it('a re-indexing strict guard blocks a NEW cycle while the watcher, a prompt hook and MCP run concurrently', async () => {
    await writeFile(join(proj, 'src/c.ts'), "import { delta } from './d';\nexport function gamma() { return delta(); }\n");
    await writeFile(join(proj, 'src/d.ts'), "import { gamma } from './c';\nexport function delta() { return gamma(); }\n");
    const [guard, prompt, summary] = await Promise.all([
      runHook(commands.guard, postToolUse('src/d.ts'), env, proj),
      runHook(commands.prompt, { hook_event_name: 'UserPromptSubmit', prompt: 'delta', cwd: proj }, env, proj),
      mcp.callTool({ name: 'get_summary', arguments: {} }),
    ]);
    for (const run of [guard, prompt]) {
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).not.toMatch(/unavailable|graph lock|did NOT check|stale|cached digest/i);
    }
    const g = parse(guard.stdout);
    expect(g.decision).toBe('block');
    expect(g.reason).toContain('1 new cycle');
    expect(g.hookSpecificOutput?.additionalContext).toContain('NEW cycles touching changes');
    expect(g.hookSpecificOutput?.additionalContext).toContain('src/c.ts -> src/d.ts');
    expect(parse(prompt.stdout).hookSpecificOutput?.additionalContext).toContain('FlowLens Agent Context');
    expect((summary as ToolResult).isError).toBeFalsy();
  }, TIMEOUT);

  it('the MCP client still answers, sees the re-indexed edit, and serves flowlens://health', async () => {
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const r = (await mcp.callTool({ name: 'detect_cycles', arguments: { granularity: 'file' } })) as ToolResult;
      const text = r.content.map((c) => c.text).join('\n');
      found = !r.isError && text.includes('src/c.ts') && text.includes('src/d.ts');
      if (!found) await sleep(250);
    }
    expect(found).toBe(true);
    const health = await mcp.readResource({ uri: 'flowlens://health' });
    const text = (health.contents[0] as { text: string }).text;
    expect(text).toMatch(/grade/i);
    expect(text).not.toMatch(/could not be built/);
  }, TIMEOUT);

  it('a pre-existing cycle does not block, and context stays on the cached digest after the watcher re-applies the edit', async () => {
    // Everything except the file about to be edited was "edited long ago".
    const old = new Date(Date.now() - 60_000);
    for (const p of ['src/b.ts', 'src/c.ts', 'src/d.ts', 'src', '.']) await utimes(join(proj, p), old, old);
    await writeFile(join(proj, 'src/a.ts'), "import { b } from './b';\nexport function alpha() { return b() + 1; }\n");
    const guard = await runHook(commands.guard, postToolUse('src/a.ts'), env, proj);
    expect(guard.code, guard.stderr).toBe(0);
    if (guard.stdout.trim()) {
      const out = parse(guard.stdout);
      expect(out.decision).toBeUndefined();
      expect(out.hookSpecificOutput?.additionalContext).not.toMatch(/did NOT check/);
    }
    await sleep(1500); // let the daemon watcher re-apply src/a.ts (debounce 300 ms)
    const json = await runCli(['agent', 'context', '--format', 'json', '--prompt', 'alpha'], proj, env);
    expect(json.code, json.stderr).toBe(0);
    const packet = JSON.parse(json.stdout) as AgentContextPacket;
    expect(packet.digest?.source).toBe('cache');
    expect(packet.relevant_files).toContain('src/a.ts');
  }, TIMEOUT);

  it('--no-daemon while serve holds the graph through the daemon is honest, and strict never passes silently', async () => {
    const direct = await runHook(`${commands.guard.replace(' # flowlens-managed', '')} --no-daemon`, postToolUse('src/b.ts'), env, proj);
    expect(direct.code).toBe(0);
    const out = parse(direct.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/did NOT check/);
    expect(out.systemMessage).toContain('strict guard skipped');
  }, TIMEOUT);
});
