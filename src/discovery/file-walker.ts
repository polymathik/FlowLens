import fg from 'fast-glob';
import { join, extname } from 'node:path';
import { buildIgnoreFilter } from './ignore-rules.js';
import { extensionToLanguage } from '../utils/paths.js';
import type { DiscoveryConfig, DiscoveredFile } from '../contracts/discovery.js';

export async function discoverFiles(config: DiscoveryConfig): Promise<DiscoveredFile[]> {
  const extGlobs = config.supportedExtensions.map(ext => `**/*${ext}`);
  const entries = await fg(extGlobs, {
    cwd: config.rootDir,
    absolute: false,
    dot: false,
    onlyFiles: true,
  });

  const isIgnored = buildIgnoreFilter(config.excludePatterns);

  return entries
    .filter(entry => !isIgnored(entry))
    .map(entry => {
      const ext = extname(entry);
      return {
        path: entry,
        absolutePath: join(config.rootDir, entry),
        extension: ext,
        language: extensionToLanguage(ext) ?? 'unknown',
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
