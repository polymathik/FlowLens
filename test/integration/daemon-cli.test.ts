/**
 * End to end through real CLI processes (run from source via tsx):
 *  - daemon auto-start / status / stop and project registration
 *  - the old LevelDB lock bug: `serve` (real MCP SDK stdio client) + `check`
 *    + `index` concurrently on one project — all must succeed
 *  - `serve --watch` uses the daemon's watcher
 *  - `serve` auto-indexes a project without `.flowlens/`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isPidAlive } from '../../src/projects/file-lock.js';
import { OWN_PROTOCOL_KEY } from '../../src/service/daemon-info.js';
import { CLI_TS, TSX_LOADER, copyFixture, removeDir, runCli, tempDir } from '../helpers/service-env.js';

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function text(r: unknown): string {
  return (r as ToolResult).content.map((c) => c.text).join('\n');
}

async function connectServe(cwd: string, env: Record<string, string>, extra: string[] = []): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', TSX_LOADER, CLI_TS, 'serve', ...extra],
    cwd,
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'flowlens-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe('daemon via the CLI', () => {
  let home: string;
  let env: Record<string, string>;
  let root: string;

  beforeAll(async () => {
    home = await tempDir('flowlens-home-');
    env = { FLOWLENS_HOME: home, FLOWLENS_NO_DAEMON: '' };
    root = await copyFixture('layered-project');
  });

  afterAll(async () => {
    await runCli(['daemon', 'stop'], home, env);
    await removeDir(home);
  });

  it('concurrent auto-starts converge on a single daemon', async () => {
    const results = await Promise.all([0, 1, 2, 3].map(() => runCli(['daemon', 'start'], home, env)));
    for (const r of results) expect(r.code, r.stderr).toBe(0);
    const pids = new Set(results.map((r) => /pid (\d+)/.exec(r.stdout)?.[1]));
    expect(pids.size).toBe(1);
  }, 90_000);

  it('init auto-starts the daemon and registers the project', async () => {
    const r = await runCli(['init'], root, env);
    expect(r.code, r.stderr).toBe(0);
    const status = await runCli(['daemon', 'status', '--json'], root, env);
    const s = JSON.parse(status.stdout) as { running: boolean; pid: number; token?: string; projects: Array<{ root: string; status: string }> };
    expect(s.running).toBe(true);
    expect(s.token).toBeUndefined();
    expect(isPidAlive(s.pid)).toBe(true);
    expect(s.projects.map((p) => p.root)).toContain(root);
    const list = JSON.parse((await runCli(['projects', 'list', '--json'], root, env)).stdout) as Array<{ name: string; last_indexed: string | null }>;
    expect(list[0].name).toBe('layered-project');
    expect(list[0].last_indexed).not.toBeNull();
  }, 90_000);

  it('serve + check + index run concurrently on one project (the old lock bug)', async () => {
    const mcp = await connectServe(root, env);
    try {
      const before = text(await mcp.callTool({ name: 'get_summary', arguments: {} }));
      expect(before).toMatch(/file/i);
      const [check, index, summary] = await Promise.all([
        runCli(['check', '--format', 'json'], root, env),
        runCli(['index'], root, env),
        mcp.callTool({ name: 'get_summary', arguments: {} }),
      ]);
      expect(check.code, check.stderr).toBeLessThan(2); // 0 clean / 1 issues — never 2 (error)
      expect(JSON.parse(check.stdout).summary).toBeDefined();
      expect(index.code, index.stderr).toBe(0);
      expect((summary as ToolResult).isError).toBeFalsy();
      // A second check while serve still holds its lease.
      const again = await runCli(['check', '--cycles'], root, env);
      expect(again.code, again.stderr).toBeLessThan(2);
    } finally {
      await mcp.close();
    }
  }, 120_000);

  it('serve --watch keeps the graph fresh through the daemon watcher', async () => {
    const mcp = await connectServe(root, env, ['--watch']);
    try {
      await sleep(500);
      await writeFile(join(root, 'brand-new-module.ts'), 'export function brandNewThing(): number { return 42; }\n');
      let found = false;
      for (let i = 0; i < 60 && !found; i++) {
        await sleep(250);
        const r = (await mcp.callTool({ name: 'get_context', arguments: { entity: 'brandNewThing' } })) as ToolResult;
        found = !r.isError && /"name":\s*"brandNewThing"/.test(text(r));
      }
      expect(found).toBe(true);
    } finally {
      await mcp.close();
    }
  }, 60_000);

  it('serve auto-indexes a project that has no .flowlens/', async () => {
    const fresh = await copyFixture('simple-project');
    expect(existsSync(join(fresh, '.flowlens'))).toBe(false);
    const mcp = await connectServe(fresh, env);
    try {
      expect(existsSync(join(fresh, '.flowlens', 'graph'))).toBe(true);
      const summary = text(await mcp.callTool({ name: 'get_summary', arguments: {} }));
      expect(summary).toMatch(/UserService|user-service|files?/i);
    } finally {
      await mcp.close();
    }
  }, 90_000);

  it('--no-daemon still opens the graph directly', async () => {
    const r = await runCli(['check', '--no-daemon', '--cycles'], root, env);
    expect(r.code, r.stderr).toBeLessThan(2);
  }, 60_000);

  it('daemon stop shuts the daemon down and the next command restarts it', async () => {
    const before = JSON.parse((await runCli(['daemon', 'status', '--json'], root, env)).stdout) as { pid: number };
    const stop = await runCli(['daemon', 'stop'], root, env);
    expect(stop.code, stop.stderr).toBe(0);
    expect(isPidAlive(before.pid)).toBe(false);
    expect(existsSync(join(home, `daemon-p${OWN_PROTOCOL_KEY}.json`))).toBe(false);
    expect(existsSync(join(home, 'daemon.json'))).toBe(false); // legacy file is never written
    const status = await runCli(['daemon', 'status'], root, env);
    expect(status.code).toBe(3);
    const check = await runCli(['check', '--cycles'], root, env);
    expect(check.code, check.stderr).toBeLessThan(2);
    const after = JSON.parse((await runCli(['daemon', 'status', '--json'], root, env)).stdout) as { pid: number };
    expect(after.pid).not.toBe(before.pid);
  }, 90_000);
});
