/**
 * The single loader for `.flowlens/architecture.json` (previously duplicated
 * in five places). Validates the file against the contract schema so a broken
 * config is reported instead of silently producing zero violations.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import {
  ArchitectureConfigSchema,
  type ArchConfigLoadResult,
} from '../contracts/analysis/architecture-config-schema.js';

export const ARCHITECTURE_FILE = 'architecture.json';

export async function loadArchConfig(flowlensDir: string): Promise<ArchConfigLoadResult> {
  const path = join(flowlensDir, ARCHITECTURE_FILE);
  if (!existsSync(path)) return { status: 'missing', path };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf-8'));
  } catch (err) {
    return { status: 'invalid', path, message: `not valid JSON: ${(err as Error).message}` };
  }
  const parsed = ArchitectureConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: 'invalid',
      path,
      message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    };
  }
  const config = parsed.data as unknown as ArchitectureConfig;
  const names = new Set(config.layers.map((l) => l.name));
  for (const layer of config.layers) {
    for (const ref of [...(layer.may_only_access ?? []), ...(layer.must_not_access ?? [])]) {
      if (!names.has(ref)) {
        return { status: 'invalid', path, message: `layer '${layer.name}' references unknown layer '${ref}'` };
      }
    }
  }
  return { status: 'ok', config, path };
}

/** Convenience: the config when present and valid, otherwise null. */
export async function loadArchConfigOrNull(flowlensDir: string): Promise<ArchitectureConfig | null> {
  const r = await loadArchConfig(flowlensDir);
  return r.status === 'ok' ? r.config : null;
}

/** Human-readable message for a non-ok load result. */
export function describeArchConfigProblem(r: ArchConfigLoadResult): string {
  if (r.status === 'missing') return `No ${ARCHITECTURE_FILE} found at ${r.path} — run "flowlens init" (or write one) first`;
  if (r.status === 'invalid') return `Invalid ${ARCHITECTURE_FILE} (${r.path}): ${r.message}`;
  return '';
}
