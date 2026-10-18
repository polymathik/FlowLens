import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';
import { ARCHITECTURE_FILE, loadArchConfig } from '../../analysis/arch-config.js';

/**
 * Validates `.flowlens/architecture.json` with the same loader every command
 * uses (`loadArchConfig`: v2 schema + layer references), so doctor can never
 * call a file valid that `check`/MCP/agents would reject. Missing file is a
 * warning (architecture.json is optional); unparseable JSON is an error; a
 * schema problem is a warning because commands then skip layer checks.
 */
export const architectureValidCheck: DiagnosticRunner = async ({ flowlensDir }) => {
  const base = {
    name: 'architecture-valid',
    title: 'architecture.json valid',
  };
  const result = await loadArchConfig(flowlensDir);
  if (result.status === 'missing') {
    return { ...base, status: 'warning', message: 'architecture.json not present (skip if intentional)' };
  }
  if (result.status === 'ok') {
    const count = result.config.layers.length;
    return { ...base, status: 'ok', message: `architecture.json valid (${count} layer${count === 1 ? '' : 's'})` };
  }
  if (result.message.startsWith('not valid JSON')) {
    return { ...base, status: 'error', message: `architecture.json invalid: ${result.message}` };
  }
  const version = declaredVersion(flowlensDir);
  if (version !== 2) {
    return {
      ...base,
      status: 'warning',
      message: `architecture.json version ${String(version)} is not v2`,
      details: 'Layer checks are skipped until it is regenerated ("flowlens init --force") or fixed.',
    };
  }
  return {
    ...base,
    status: 'warning',
    message: `architecture.json does not match the v2 schema: ${result.message}`,
    details: 'Layer checks are skipped until it is fixed.',
  };
};

function declaredVersion(flowlensDir: string): unknown {
  const path = join(flowlensDir, ARCHITECTURE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return (JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown }).version;
  } catch {
    return undefined;
  }
}
