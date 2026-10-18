/** Read a project's `.flowlens/config.json` exclude globs (empty when absent/invalid). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowLensConfig } from '../contracts/config.js';

export function loadProjectExcludes(root: string): string[] {
  const p = join(root, '.flowlens', 'config.json');
  if (!existsSync(p)) return [];
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as FlowLensConfig).exclude ?? [];
  } catch {
    return [];
  }
}
