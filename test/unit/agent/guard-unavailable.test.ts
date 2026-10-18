/** Strict guard must never look like a clean pass when the graph cannot be read. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentGuard, type RunGuardOptions } from '../../../src/agent/run-guard.js';
import type { ClaudeHookOutput } from '../../../src/contracts/agent.js';

describe('agent guard when the graph cannot be read', () => {
  let root: string;
  const base = (): RunGuardOptions => ({
    rootDir: root, explicitFiles: ['src/a.ts'], hookInput: {}, hook: true, useGit: false, reindex: true,
    strict: true, maxItems: 10, format: 'markdown', minRisk: 'medium', daemon: false,
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowlens-guard-unavail-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, '.flowlens'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'export const a = 1;\n');
    await writeFile(join(root, '.flowlens/graph'), 'not a LevelDB directory'); // open fails, not a lock
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('hook mode: says the edit was NOT checked and warns the user under --strict', async () => {
    const result = await runAgentGuard(base());
    expect(result.exit_code).toBe(0);
    const out = JSON.parse(result.stdout) as ClaudeHookOutput;
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/cannot read the graph.*did NOT check/s);
    expect(out.systemMessage).toContain('strict guard skipped: the graph could not be read');
  });

  it('CLI mode: exit 1 under --strict, 0 without', async () => {
    const strict = await runAgentGuard({ ...base(), hook: false, format: 'json' });
    expect(strict.exit_code).toBe(1);
    expect(JSON.parse(strict.stdout)).toMatchObject({ available: false, checked: false, reason: 'error' });
    const lax = await runAgentGuard({ ...base(), hook: false, strict: false });
    expect(lax.exit_code).toBe(0);
    expect(lax.stderr).toContain('did NOT check');
  });
});
