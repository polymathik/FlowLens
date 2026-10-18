/**
 * Phase 12 review M2: launch files keep the one-time sign-in code out of
 * the browser's argv, are private (0600 in a 0700 dir) and short-lived.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  launchFileDir, launchFileHtml, pruneLaunchFiles, scheduleLaunchFileRemoval, writeLaunchFile,
} from '../../../src/cli/canvas-host/launch-file.js';
import { SessionStore } from '../../../src/service/sessions.js';
import { AUTH_CODE_TTL_MS } from '../../../src/contracts/canvas/explorer.js';

const URL_ = 'http://127.0.0.1:4280/auth?t=abc_DEF-123&x=1';

describe('launch files', () => {
  let home: string;
  const outer = process.env.FLOWLENS_HOME;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'flowlens-launch-'));
    process.env.FLOWLENS_HOME = home;
  });
  afterEach(() => {
    process.env.FLOWLENS_HOME = outer;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes a private redirect file whose path carries no secret', async () => {
    const path = writeLaunchFile(URL_);
    expect(path.startsWith(join(home, 'run', 'open-'))).toBe(true);
    expect(path).not.toContain('abc_DEF');
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(launchFileDir()).mode & 0o777).toBe(0o700);
    }
    const html = await readFile(path, 'utf8');
    expect(html).toContain('location.replace("http://127.0.0.1:4280/auth?t=abc_DEF-123&x=1")');
    expect(html).toContain('content="0;url=http://127.0.0.1:4280/auth?t=abc_DEF-123&#38;x=1"');
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  it('escapes markup in the URL', () => {
    const html = launchFileHtml('http://127.0.0.1/auth?t="></script><b>');
    expect(html).not.toContain('</script><b>');
  });

  it('prunes files older than the TTL and removes a scheduled one', async () => {
    const old = writeLaunchFile(URL_);
    const past = new Date(Date.now() - 60_000);
    utimesSync(old, past, past);
    const fresh = writeLaunchFile(URL_); // writing prunes too
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(pruneLaunchFiles()).toBe(0);
    scheduleLaunchFileRemoval(fresh, 200);
    for (let i = 0; i < 60 && existsSync(fresh); i++) await sleep(50);
    expect(existsSync(fresh)).toBe(false);
  });
});

describe('sign-in code lifetime', () => {
  it('defaults to 15 s and accepts a per-code TTL', () => {
    expect(AUTH_CODE_TTL_MS).toBe(15_000);
    let now = 0;
    const s = new SessionStore(undefined, undefined, () => now);
    const short = s.mintCode();
    const long = s.mintCode(undefined, 120_000);
    now += 15_001;
    expect(s.exchange(short)).toBeNull();
    expect(s.exchange(long)).not.toBeNull();
  });
});
