/**
 * Browser launch files (Phase 12 review M2), the way Jupyter does it: the
 * one-time sign-in URL must not appear in the browser's command line,
 * where any local user can read it (`ps`, /proc/<pid>/cmdline). The CLI
 * writes a 0600 HTML file with a random name to `$FLOWLENS_HOME/run/`
 * (0700) that redirects to the `/auth?t=…` URL, opens the FILE, and
 * deletes it after `LAUNCH_FILE_TTL_MS` (a detached helper does it, since
 * `flowlens canvas` usually exits at once; every launch also prunes old
 * files). The code itself expires after 15 s and works once.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAUNCH_FILE_DIR, LAUNCH_FILE_TTL_MS } from '../../contracts/canvas/explorer.js';
import { ensureFlowlensHome } from '../../projects/paths.js';

const PREFIX = 'open-';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function launchFileDir(): string {
  const dir = join(ensureFlowlensHome(), LAUNCH_FILE_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try { chmodSync(dir, 0o700); } catch { /* best effort */ }
  }
  return dir;
}

export function launchFileHtml(url: string): string {
  const u = escapeHtml(url);
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${u}"><title>Opening FlowLens…</title>
<script>location.replace(${JSON.stringify(url).replace(/</g, '\\u003c')});</script>
<p>Opening FlowLens… <a href="${u}">continue</a></p>
`;
}

/** Write a launch file for `url`; returns its absolute path. */
export function writeLaunchFile(url: string, dir = launchFileDir()): string {
  pruneLaunchFiles(dir);
  const path = join(dir, `${PREFIX}${randomBytes(16).toString('hex')}.html`);
  writeFileSync(path, launchFileHtml(url), { mode: 0o600, flag: 'wx' });
  return path;
}

/** Remove launch files older than `maxAgeMs`. */
export function pruneLaunchFiles(dir = launchFileDir(), maxAgeMs = LAUNCH_FILE_TTL_MS, now = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(PREFIX) || !name.endsWith('.html')) continue;
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs >= maxAgeMs) {
        unlinkSync(p);
        removed++;
      }
    } catch { /* raced */ }
  }
  return removed;
}

/** Delete `path` after `delayMs`, from a detached helper so this process can exit now. */
export function scheduleLaunchFileRemoval(path: string, delayMs = LAUNCH_FILE_TTL_MS): void {
  try {
    const child = spawn(process.execPath, [
      '-e', 'setTimeout(()=>{try{require("node:fs").unlinkSync(process.argv[1])}catch{}},Number(process.argv[2]))',
      path, String(delayMs),
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* the next launch prunes it */ }
}
