/** Phase 12 review L3: `$FLOWLENS_HOME` is tightened to 0700. */
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFlowlensHome } from '../../../src/projects/paths.js';

describe.skipIf(process.platform === 'win32')('ensureFlowlensHome', () => {
  it('chmods an existing home with looser permissions to 0700', () => {
    const outer = process.env.FLOWLENS_HOME;
    const base = mkdtempSync(join(tmpdir(), 'flowlens-perm-'));
    const home = join(base, 'home');
    try {
      process.env.FLOWLENS_HOME = home;
      ensureFlowlensHome();
      expect(statSync(home).mode & 0o777).toBe(0o700);
      chmodSync(home, 0o755);
      ensureFlowlensHome();
      expect(statSync(home).mode & 0o777).toBe(0o700);
    } finally {
      process.env.FLOWLENS_HOME = outer;
      rmSync(base, { recursive: true, force: true });
    }
  });
});
