import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

/**
 * Validates `.flowlens/config.json` against the FlowLensConfig contract:
 * an `exclude` string array and a `languages` record of booleans. Both are
 * required; other fields (e.g. `ai`) are optional and validated by their
 * own consumers.
 */
export const configValidCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = {
    name: 'config-valid',
    title: 'config.json valid',
  };
  const configPath = join(flowlensDir, 'config.json');
  if (!existsSync(configPath)) {
    return {
      ...base,
      status: 'error',
      message: 'config.json missing',
    };
  }
  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as {
      exclude?: unknown;
      languages?: unknown;
    };
    const missing: string[] = [];
    if (!Array.isArray(parsed.exclude)) missing.push('exclude');
    if (!parsed.languages || typeof parsed.languages !== 'object')
      missing.push('languages');
    if (missing.length > 0) {
      return {
        ...base,
        status: 'warning',
        message: `config.json missing required fields: ${missing.join(', ')}`,
      };
    }
    return { ...base, status: 'ok', message: 'config.json parses cleanly' };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `config.json invalid: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
