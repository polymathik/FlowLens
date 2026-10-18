/**
 * Per-test-file isolation of user-level FlowLens state (vitest `setupFiles`).
 *
 * Runs in each test file's worker before the file's own imports, so every
 * registry write, daemon.json and auto-started daemon (including those of
 * CLI / hook child processes, which inherit the env) lands in a fresh temp
 * `$FLOWLENS_HOME`, never in the real `~/.flowlens`. After the file, any
 * daemon still registered there is stopped and the directory removed.
 */
import { afterAll } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'flowlens-test-home-')));
process.env.FLOWLENS_HOME = home;

afterAll(async () => {
  process.env.FLOWLENS_HOME = home; // a test may have pointed it elsewhere
  const { findDaemon, stopDaemon } = await import('../../src/service/autostart.js');
  const daemon = await findDaemon().catch(() => null);
  if (daemon) await stopDaemon(daemon);
  rmSync(home, { recursive: true, force: true });
}, 30_000);
