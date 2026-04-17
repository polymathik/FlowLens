import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

const MIN_NODE_MAJOR = 20;

/** Reports the Node.js version and flags anything older than the supported floor. */
export const nodeVersionCheck: DiagnosticRunner = async () => {
  const base = { name: 'node-version', title: 'Node.js version' };
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0] ?? '0', 10);
  if (major < MIN_NODE_MAJOR) {
    return {
      ...base,
      status: 'error',
      message: `Node.js v${v} is below required v${MIN_NODE_MAJOR}.0.0`,
    };
  }
  return { ...base, status: 'ok', message: `Node.js v${v}` };
};

/** Reports whether `git` is on PATH. Warning if missing — git is used for churn analysis. */
export const gitAvailableCheck: DiagnosticRunner = async () => {
  const base = { name: 'git-available', title: 'Git available' };
  try {
    const out = execSync('git --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ...base, status: 'ok', message: out.trim() };
  } catch {
    return {
      ...base,
      status: 'warning',
      message: 'git not found on PATH (churn analysis disabled)',
    };
  }
};

const DISK_WARN_MB = 500;

/** Recursive size estimator for `.flowlens/` — warns above DISK_WARN_MB. */
export const diskSpaceCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = { name: 'disk-space', title: '.flowlens/ size' };
  try {
    const bytes = await dirSize(flowlensDir);
    const mb = bytes / (1024 * 1024);
    const formatted = mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    if (mb > DISK_WARN_MB) {
      return {
        ...base,
        status: 'warning',
        message: `${formatted} (>${DISK_WARN_MB} MB threshold)`,
      };
    }
    return { ...base, status: 'ok', message: formatted };
  } catch (err) {
    return {
      ...base,
      status: 'warning',
      message: `could not measure: ${String(err)}`,
    };
  }
};

async function dirSize(path: string): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  let total = 0;
  try {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        total += await dirSize(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    }
  } catch {
    /* non-fatal */
  }
  return total;
}
