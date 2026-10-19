/**
 * Integration: the real `claude` CLI against a scratch HOME (never the user's config). Skipped when the CLI
 * is not installed. Does not start a Claude session; only `claude mcp add|get|remove`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whichSync } from '../../src/agent/setup/claude-cli.js';
import { installClaudeMcp, uninstallClaudeMcp } from '../../src/agent/setup/mcp-claude.js';
import { detectMcpConnection } from '../../src/agent/setup/mcp-detect.js';

const claude = whichSync('claude');

describe.skipIf(!claude)('real claude CLI (scratch HOME)', () => {
  it('registers, detects, refreshes and removes the FlowLens server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fl-real-claude-'));
    const home = join(root, 'home');
    const proj = join(root, 'proj');
    mkdirSync(home);
    mkdirSync(proj);
    execFileSync('git', ['init', '-q'], { cwd: proj });
    const saved = { ...process.env };
    Object.assign(process.env, { HOME: home, USERPROFILE: home });
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      const first = await installClaudeMcp({ projectDir: proj, scope: 'local', command: 'node "/abs path/flowlens/dist/cli/index.js"', homeDir: home });
      expect(first).toMatchObject({ method: 'claude-cli', changed: true });
      const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'));
      expect(cfg.projects[proj].mcpServers.flowlens).toMatchObject({ type: 'stdio', command: 'node', args: ['/abs path/flowlens/dist/cli/index.js', 'serve'] });
      expect(await detectMcpConnection(proj, 'claude-code', { homeDir: home })).toEqual({ state: 'connected', via: '~/.claude.json (local scope)' });

      const again = await installClaudeMcp({ projectDir: proj, scope: 'local', command: 'node "/abs path/flowlens/dist/cli/index.js"', homeDir: home });
      expect(again.changed).toBe(false);
      const moved = await installClaudeMcp({ projectDir: proj, scope: 'local', command: 'node "/elsewhere/flowlens/dist/cli/index.js"', homeDir: home });
      expect(moved.changed).toBe(true);
      expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8')).projects[proj].mcpServers.flowlens.args[0]).toBe('/elsewhere/flowlens/dist/cli/index.js');

      const removed = await uninstallClaudeMcp(proj, { homeDir: home });
      expect(removed.removed).toEqual(['claude mcp remove flowlens --scope local']);
      expect((await detectMcpConnection(proj, 'claude-code', { homeDir: home })).state).toBe('not_connected');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  }, 120_000);
});
