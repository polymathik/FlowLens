import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

export const flowlensDirCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = {
    name: 'flowlens-dir-exists',
    title: '.flowlens/ directory exists',
  };
  try {
    if (!existsSync(flowlensDir)) {
      return {
        ...base,
        status: 'error',
        message: '.flowlens/ not found',
        details: 'Run "flowlens init" to create it.',
      };
    }
    if (!statSync(flowlensDir).isDirectory()) {
      return {
        ...base,
        status: 'error',
        message: '.flowlens/ exists but is not a directory',
      };
    }
    const required = ['graph', 'config.json'];
    const missing = required.filter((p) => !existsSync(join(flowlensDir, p)));
    if (missing.length > 0) {
      return {
        ...base,
        status: 'warning',
        message: `.flowlens/ missing: ${missing.join(', ')}`,
        details: 'Re-run "flowlens init" or "flowlens index".',
      };
    }
    return { ...base, status: 'ok', message: '.flowlens/ is present' };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `failed to check .flowlens/: ${String(err)}`,
    };
  }
};
