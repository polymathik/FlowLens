/**
 * ManifestStore — reads/writes `.flowlens/manifest.json` atomically
 * (write to a temp file, then rename) so readers never see a torn file.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphManifest, ManifestStore } from '../contracts/manifest.js';

export const MANIFEST_FILE = 'manifest.json';

export class FileManifestStore implements ManifestStore {
  async read(flowlensDir: string): Promise<GraphManifest | null> {
    const p = join(flowlensDir, MANIFEST_FILE);
    if (!existsSync(p)) return null;
    try {
      const v = JSON.parse(await readFile(p, 'utf-8')) as GraphManifest;
      return typeof v.project_id === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  async write(flowlensDir: string, manifest: GraphManifest): Promise<void> {
    await mkdir(flowlensDir, { recursive: true });
    const p = join(flowlensDir, MANIFEST_FILE);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
    await rename(tmp, p);
  }
}

export const manifestStore = new FileManifestStore();
