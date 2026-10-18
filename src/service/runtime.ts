/**
 * Runtime facts the service needs: the package version and how to launch
 * the FlowLens CLI as a child process (compiled `dist/cli/index.js`, or the
 * TypeScript source through tsx when running from `src/` in tests/dev).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** `src/service` and `dist/service` are both two levels below the package root. */
export const FLOWLENS_VERSION: string = (require('../../package.json') as { version: string }).version;

export interface CliLaunch {
  command: string;
  args: string[];
}

/** Override for unusual installs: absolute path to the CLI entry file. */
export const CLI_ENTRY_ENV = 'FLOWLENS_CLI_ENTRY';

export function cliLaunch(cliArgs: string[]): CliLaunch {
  const override = process.env[CLI_ENTRY_ENV];
  const js = fileURLToPath(new URL('../cli/index.js', import.meta.url));
  const ts = fileURLToPath(new URL('../cli/index.ts', import.meta.url));
  const entry = override ?? (existsSync(js) ? js : ts);
  if (entry.endsWith('.ts')) {
    const tsx = resolveTsxLoader();
    return { command: process.execPath, args: ['--import', tsx, entry, ...cliArgs] };
  }
  return { command: process.execPath, args: [entry, ...cliArgs] };
}

/**
 * URL of tsx's ESM loader for `node --import`. `import.meta.resolve` is not
 * available under some module runners (e.g. vitest), so fall back to
 * CommonJS resolution of the package's `exports["."]` target.
 */
function resolveTsxLoader(): string {
  try {
    return import.meta.resolve('tsx');
  } catch {
    return pathToFileURL(require.resolve('tsx')).href;
  }
}
