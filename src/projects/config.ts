/** Read a project's `.flowlens/config.json` (defaults when absent/invalid). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowLensConfig } from '../contracts/config.js';

/** Used when a project has no readable config: nothing excluded, every language enabled. */
export const FALLBACK_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: {},
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

export function loadProjectConfig(root: string): FlowLensConfig {
  const p = join(root, '.flowlens', 'config.json');
  if (!existsSync(p)) return FALLBACK_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<FlowLensConfig>;
    return {
      exclude: raw.exclude ?? [],
      languages: raw.languages ?? {},
      ai: raw.ai ?? FALLBACK_CONFIG.ai,
    };
  } catch {
    return FALLBACK_CONFIG;
  }
}

export function loadProjectExcludes(root: string): string[] {
  return loadProjectConfig(root).exclude;
}
