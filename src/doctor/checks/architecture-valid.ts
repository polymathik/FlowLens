import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

/**
 * Validates `.flowlens/architecture.json` against the v2 schema — a top-level
 * `layers` array with named layers. Missing file is a warning (not error):
 * architecture.json is optional; commands degrade gracefully without it.
 */
export const architectureValidCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = {
    name: 'architecture-valid',
    title: 'architecture.json valid',
  };
  const archPath = join(flowlensDir, 'architecture.json');
  if (!existsSync(archPath)) {
    return {
      ...base,
      status: 'warning',
      message: 'architecture.json not present (skip if intentional)',
    };
  }
  try {
    const content = await readFile(archPath, 'utf-8');
    const parsed = JSON.parse(content) as { version?: unknown; layers?: unknown };
    if (parsed.version !== 2) {
      return {
        ...base,
        status: 'warning',
        message: `architecture.json version ${String(parsed.version)} is not v2`,
      };
    }
    if (!Array.isArray(parsed.layers)) {
      return {
        ...base,
        status: 'warning',
        message: 'architecture.json missing "layers" array',
      };
    }
    const count = parsed.layers.length;
    return {
      ...base,
      status: 'ok',
      message: `architecture.json valid (${count} layer${count === 1 ? '' : 's'})`,
    };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `architecture.json invalid: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
