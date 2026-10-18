import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchitectureConfig } from '../contracts/architecture.js';

export async function loadArchitecture(
  flowlensDir: string,
): Promise<ArchitectureConfig | null> {
  const path = join(flowlensDir, 'architecture.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as ArchitectureConfig;
  } catch {
    return null;
  }
}
