/**
 * Wave 2 small CLI fixes (spawned CLI, isolated $FLOWLENS_HOME):
 *  - `init --ai --provider <bogus>` exits 2 BEFORE creating .flowlens/ or indexing
 *  - printError goes to stderr (stdout stays clean for pipes)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { removeDir, runCli, tempDir } from '../helpers/service-env.js';

describe('CLI small fixes', () => {
  let home: string;
  let root: string;
  let env: Record<string, string>;
  beforeAll(async () => {
    home = await tempDir('flowlens-home-');
    env = { FLOWLENS_HOME: home, FLOWLENS_NO_DAEMON: '', FORCE_COLOR: '0' };
    root = await tempDir('flowlens-small-fixes-');
    await writeFile(join(root, 'index.ts'), 'export const x = 1;\n');
  });
  afterAll(async () => {
    await runCli(['daemon', 'stop'], home, env);
    await removeDir(home);
    await removeDir(root);
  });

  it('init --ai --provider bogus exits 2 before indexing', async () => {
    const r = await runCli(['init', '--ai', '--provider', 'bogus'], root, env);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown AI provider "bogus"');
    expect(r.stdout).not.toContain('Indexed');
    expect(existsSync(join(root, '.flowlens'))).toBe(false);
  }, 60_000);

  it('errors are printed to stderr, not stdout', async () => {
    const r = await runCli(['export'], root, env); // no .flowlens/
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('.flowlens/ not found');
  }, 60_000);
});
